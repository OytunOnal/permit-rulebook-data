import { createHash } from "node:crypto";
import { htmlToText, normalize } from "./normalize.js";
import { pdfToText } from "./pdf-text.js";
import { repairKnownGlyphs, unboundedReason, type GlyphSubstitution } from "./corrections.js";
import { noticeSources, provenancedValuesOf, routeStatements, statementSources, forEachCriterion } from "../engine.js";
import { countryVocabulary } from "../countries.js";
import { datasetSourceUrls, usesCountryVocabulary, type Snapshot, type UnreadEntry, type WatchState } from "./state.js";
import { failureOfStatus, type FailureClass } from "./failure.js";
import { addressWithoutCredentials, shortAddress } from "./fetch-source.js";
import type { Dataset, UnsourcedReasonWord } from "../types.js";

/**
 * The state's own shape, and the derivations over it, live in `state.ts` — the
 * site reads them too, and nothing there may reach a Node built-in. This file
 * is what WRITES the state; it passes on only the two names its own callers
 * have always asked it for, so the module that writes the state does not
 * become a second door onto everything that reads it.
 */
export { datasetSourceUrls } from "./state.js";
export type { Snapshot, UnreadEntry, WatchState } from "./state.js";
/** What kind of failure a read was — the rule, and both readers' one owner. */
export { failureOfStatus, ReadFailure } from "./failure.js";
export type { FailureClass } from "./failure.js";

export type WatchStrategy = "html" | "browser" | "pdf" | "pdf-text" | "human" | "link";

/**
 * What each strategy is, in one place.
 *
 * The strategies had grown five switches across two files — the human arm, the
 * link arm, the read, the quote gate's "no text snapshot" wording and the
 * CLI's remediation — and `pdf-text` was named in only one of them: a changed
 * decoded PDF fell through to the generic "update the dataset value" advice,
 * which is not what a curator should do with a PDF whose words moved (review
 * 2026-09-07). One table now, and a strategy that forgets a row will not
 * compile.
 */
/**
 * How far a redirect may be followed, and why that is not one answer.
 *
 * `same-origin` is the rule for anything whose bytes become a READING: what
 * a source redirects to is not the source, and an off-site landing — or a
 * downgrade to plain http, where anyone on the path may rewrite the page —
 * must not be hashed as the authority's words and checked against its quotes.
 *
 * `anywhere` is the rule for an entry that produces no reading. A learn link
 * backs no value and is never compared; what is watched is that a person who
 * clicks it arrives somewhere. Following it the way that person's browser
 * would is the only way to learn that, and refusing a redirect they would
 * happily take reports a working link as broken — which is what happened:
 * `anabin.kmk.org` answers https with a 301 to plain http on the same host,
 * and the guard written for readings turned a live government link red every
 * morning (runner run 35934301563, 2026-09-24).
 *
 * The hop cap applies to both, and neither will carry credentials.
 */
export type RedirectPolicy = "same-origin" | "anywhere";

export const STRATEGIES: Record<WatchStrategy, {
  /** Whether a pass fetches the source at all. */
  fetches: boolean;
  /** How far a redirect may be followed on this strategy — the rule above. */
  redirects: RedirectPolicy;
  /** Whether what came back is compared against the last snapshot. A learn
   * link is fetched and not compared: its wording may change freely, and only
   * silence is news. */
  compares: boolean;
  /** What the quote gate says when there is no text to check a quote against
   * on this strategy — its honest answer, never a silent pass. */
  no_text_snapshot: string;
  /** What a curator must do when a source on this strategy changes. */
  remediation: string;
}> = {
  html: {
    fetches: true, compares: true, redirects: "same-origin",
    no_text_snapshot: "html tier — no text snapshot; the source has not been fetched yet",
    remediation: "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  browser: {
    // html's twin: everything downstream of the reading is html's, because the
    // difference is the reader and nothing else. What comes back is the page a
    // person sees rather than the shell a `fetch` is handed, so the words a
    // curator is sent to fix are the same words, found the same way.
    fetches: true, compares: true, redirects: "same-origin",
    no_text_snapshot: "browser tier — no text snapshot; no browser has opened the page yet",
    remediation: "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  "pdf-text": {
    fetches: true, compares: true, redirects: "same-origin",
    no_text_snapshot: "pdf-text tier — no text snapshot; the source has not been fetched yet",
    remediation: "The PDF's WORDS changed, not just its bytes. Read the diff context below, then update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  pdf: {
    fetches: true, compares: true, redirects: "same-origin",
    no_text_snapshot: "pdf tier — the bytes are watched; nothing here reads the document's words",
    remediation: "PDF changed — a human must read it; no value is extracted automatically.",
  },
  link: {
    // The one strategy that follows a redirect anywhere, because it is the
    // one that is not reading anything: what it watches is whether a person
    // who clicks arrives, and a person's browser follows.
    fetches: true, compares: false, redirects: "anywhere",
    no_text_snapshot: "link tier — a learn link backs no value, so no quote rests on it",
    remediation: "A learn link backs no value; only silence is news here.",
  },
  human: {
    // Never fetched, so the policy is a formality — the table is exhaustive
    // on purpose, and the strict answer is the safe one to leave here.
    fetches: false, compares: false, redirects: "same-origin",
    no_text_snapshot: "human tier — read by a person; no machine snapshot to check against",
    remediation: "Scheduled human re-verification is due. After verifying, update `last_verified` for this entry in watch/watchlist.json.",
  },
};

/**
 * What a browser entry may ask a page to do before it is read — the whole
 * vocabulary, and nothing outside it.
 *
 * It is small on purpose. Every step a watch entry can take is a way for the
 * read to be about a page state nobody chose, so the set is the four things a
 * person actually did to reach the IND's requirement list and no more: pick an
 * option, answer yes or no, press something, open what is folded away. A
 * recipe that needs a fifth verb is a slice with a decision in it, not a
 * watchlist edit.
 *
 * Labels, never selectors. A CSS selector pins our reading to a class name the
 * authority may rename between two Tuesdays, and when it does the step fails
 * silently or reads the wrong control; a label is what the authority shows a
 * person, and if it goes, the sentence a reader was promised has probably gone
 * with it — which is a red day worth having.
 */
export type WatchStep =
  /** Choose `option` in the field whose label is `field`. */
  | { step: "select"; field: string; option: string }
  /** Answer the yes/no question whose label is `question`. */
  | { step: "answer"; question: string; answer: "yes" | "no" }
  /** Press the button whose label is `button`. */
  | { step: "press"; button: string }
  /**
   * Open every collapsed block **in the page's own content, never in its
   * furniture**, and never by pressing a link.
   *
   * Names nothing, so it cannot fail on a label: a page with nothing folded
   * away is simply already open. Both narrowings are deliberate and both were
   * learned: opening everything that merely says it is collapsed opened the
   * site's navigation menu, which is chrome and not a sentence anyone is
   * reading; and a disclosure that is a link is a link, which would take the
   * read to another page — or another site. Nav, header, footer, aside,
   * dialog and their ARIA roles are out, named structurally so the rule
   * survives a reworded heading (s34).
   */
  | { step: "expand" };

/** The step names, and what each one requires beside the name. The validator
 * reads this, so the vocabulary is closed in one place rather than in a
 * switch a new step could be added past. */
const STEP_SHAPES: Record<WatchStep["step"], readonly string[]> = {
  select: ["field", "option"],
  answer: ["question", "answer"],
  press: ["button"],
  expand: [],
};

export interface WatchEntry {
  id: string;
  url: string;
  strategy: WatchStrategy;
  /** value-source entries must back dataset values; sentinels (edition
   * indexes, official-recheck reminders) are allowed to stand alone. */
  kind: "value-source" | "sentinel";
  note?: string;
  /** html strategy only: hash just the region between these markers (inclusive),
   * for pages whose chrome rotates (ads, promos) while the operative text stands
   * still. A missing marker reports as unreachable — never as "no change". */
  slice?: { from: string; to: string };
  /** browser strategy only: what the reader does to the page before reading
   * it, in order. An entry with no steps is simply rendered. */
  steps?: WatchStep[];
  /**
   * Deliberate changes to the ENTRY — a marker moved, a strategy swapped — with
   * the day and the reason.
   *
   * The dataset keeps an append-only history for every value it ships, and an
   * entry that decides what a value is checked against deserves the same: a
   * widened slice raises a `changed` flag that is expected, and a reader of that
   * flag six months later needs to find out here that a person moved the marker
   * on purpose rather than that the authority rewrote the page.
   */
  history?: { changed_at: string; note: string }[];
  /** link strategy only: the field whose "find out yourself" link this is,
   * so a report says which question loses its help when the page goes. */
  learn_for?: string;
  /** human strategy only */
  max_age_days?: number;
  last_verified?: string; // YYYY-MM-DD
  /** pdf-text strategy only: where this document's decoded text is known to
   * disagree with the document a person holds, declared beside the source it
   * corrects rather than in the decoder. Each correction is bounded — see
   * `corrections.ts` — and the coverage gate refuses one that is not. */
  glyph_substitutions?: GlyphSubstitution[];
}

export interface Watchlist { entries: WatchEntry[] }

export type FetchResult =
  | {
    ok: true;
    body: Uint8Array;
    /**
     * Where the bytes actually came from, when that is not the address asked
     * for — a redirect the fetcher followed, or the path a browser ended on
     * after its steps. Both readers refuse another ORIGIN outright; this is
     * for the journey within one, which is allowed and is still worth a
     * curator being able to see (s34, 2026-09-24).
     */
    from?: string;
  }
  | {
    ok: false;
    status?: number;
    error: string;
    /**
     * What kind of failure this was — what decides whether it is asked
     * again, and on which morning it reddens the run. Required, because a
     * reader that does not say is a reader whose failures all mean the same
     * thing, which is the fault s35 was written for.
     */
    failure: FailureClass;
  };
/**
 * What reads a source over HTTP. Takes the redirect policy rather than the
 * entry, because that is the only thing about the entry it needs and the one
 * thing it must not be able to get wrong by default: there is no default.
 */
export type Fetcher = (url: string, redirects: RedirectPolicy) => Promise<FetchResult>;

/**
 * What opens a browser entry, injected beside the fetcher.
 *
 * It takes the ENTRY, not the url, because a browser read is not addressed by
 * a url alone: the steps that get the page into the state worth reading travel
 * on the entry, and so does the id a timing line names. The two readers stay
 * apart rather than becoming one reader that branches, because they answer
 * different questions — a fetcher is handed an address, a browser is handed an
 * errand — and the run injects both so a test can stub either.
 */
export type BrowserReader = (entry: WatchEntry, redirects: RedirectPolicy) => Promise<FetchResult>;

export type Outcome = "unchanged" | "changed" | "baseline" | "unreachable" | "reminder-due" | "ok";

export interface WatchReport {
  id: string;
  url: string;
  strategy: WatchStrategy;
  kind: "value-source" | "sentinel";
  note?: string;
  outcome: Outcome;
  old_hash?: string;
  new_hash?: string;
  /** for html changes: quoted context around the first difference */
  context?: string;
  error?: string;
  /** unreachable only: what kind of failure it was, from the reader that met
   * it. The retry and the verdict both read this and nothing else. */
  failure?: FailureClass;
}

/**
 * The fingerprint of an entry's slice — absent for an entry that watches a
 * whole page, so an entry that never had a slice never carries one.
 */
export function sliceFingerprint(entry: WatchEntry): string | undefined {
  return entry.slice ? sha256(`${entry.slice.from} ${entry.slice.to}`) : undefined;
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function diffContext(oldText: string, newText: string, span = 120): string {
  let i = 0;
  const max = Math.min(oldText.length, newText.length);
  while (i < max && oldText[i] === newText[i]) i++;
  const start = Math.max(0, i - span / 2);
  return newText.slice(start, i + span);
}

/** Signed age in days; a future or unparsable last_verified counts as fresh
 * (0) rather than ancient — a year typo must not fire daily reminders. */
function daysSince(last: string, today: string): number {
  const diff = (new Date(today).getTime() - new Date(last).getTime()) / 86_400_000;
  return Number.isFinite(diff) ? Math.max(0, diff) : Infinity;
}

/** What one read of one source produced, before it is compared to anything. */
interface Reading {
  hash: string;
  text?: string;
  bytes_hash?: string;
  unverifiable_reason?: UnsourcedReasonWord;
}

/**
 * How each fetching strategy turns bytes into the thing "changed" is decided
 * on. The one switch over strategies that cannot be a table, because each arm
 * is an algorithm — and exhaustive, so a new strategy stops the build here
 * rather than silently reading as html.
 */
function readSource(entry: WatchEntry, body: Uint8Array): Reading {
  switch (entry.strategy) {
    case "pdf":
      return { hash: sha256(body) };
    case "pdf-text": {
      // The words decide, not the bytes: a ministry re-exporting the same
      // sheet moves every byte and no sentence, and a watch that cried
      // "changed" at that is a watch a curator learns to wave through.
      const bytes_hash = sha256(body);
      const decoded = pdfToText(body);
      // A scan. There is nothing to read, so the bytes are all there is — and
      // the quote gate is told why, in the word the dataset already uses for
      // a source published only as a picture.
      if (!decoded) return { hash: bytes_hash, bytes_hash, unverifiable_reason: "scanned-image" };
      return { hash: sha256(decoded.text), text: decoded.text, bytes_hash };
    }
    // A browser entry differs from an html one in how the bytes were obtained
    // and in nothing after it: the same tag stripping, the same normalization,
    // the same markers, the same missing-marker verdict. Sharing the arm is
    // the point of the strategy rather than a saving — the day these two read
    // a page differently is the day a browser entry's snapshot stops being
    // comparable with the html snapshot it replaced.
    case "browser":
    case "html": {
      let text = normalize(htmlToText(new TextDecoder("utf-8").decode(body)));
      if (entry.slice) {
        const from = text.indexOf(entry.slice.from);
        const to = from >= 0 ? text.indexOf(entry.slice.to, from + entry.slice.from.length) : -1;
        if (from < 0 || to < 0)
          throw new Error(`slice marker missing: ${from < 0 ? "from" : "to"}`);
        text = text.slice(from, to + entry.slice.to.length);
      }
      return { hash: sha256(text), text };
    }
    default: {
      const _exhaustive: "human" | "link" = entry.strategy;
      throw new Error(`strategy ${_exhaustive} does not read a source`);
    }
  }
}

/** A reading, dated — the fields a snapshot keeps, minus its history. */
function snapshotOf(reading: Reading, today: string, entry: WatchEntry): Omit<Snapshot, "history"> {
  const slice = sliceFingerprint(entry);
  return {
    hash: reading.hash,
    retrieved_at: today,
    ...(slice ? { slice_read: slice } : {}),
    text: reading.text,
    ...(reading.bytes_hash ? { bytes_hash: reading.bytes_hash } : {}),
    ...(reading.unverifiable_reason ? { unverifiable_reason: reading.unverifiable_reason } : {}),
  };
}

/**
 * Pure watch pass: fetches via the injected fetcher, compares against state,
 * returns per-source reports and the next state. NEVER writes anything —
 * committing the next state is the caller's explicit decision.
 */
export async function runWatch(
  watchlist: Watchlist,
  state: WatchState,
  fetcher: Fetcher,
  today: string,
  openInBrowser?: BrowserReader,
): Promise<{ reports: WatchReport[]; nextState: WatchState; verdict: RunVerdict }> {
  const nextEntries: Record<string, Snapshot> = { ...state.entries };

  /**
   * One source, read and judged — the whole of what a pass does to an entry.
   *
   * It is a function rather than the body of the loop because the retry asks
   * for exactly this a second time, and the second answer has to be judged
   * the way the first was: a source that answers on the retry is a source
   * that was READ today, with its snapshot written and its report `baseline`,
   * `unchanged` or `changed` — not one that failed and was forgiven.
   */
  const judge = async (entry: WatchEntry): Promise<WatchReport> => {
    /**
     * What every report about this entry says, made once.
     *
     * The credentials come out HERE, at the one place reports are made, so no
     * printer downstream has to remember to: a report travels into a log
     * line, a flag file and the issue that flag becomes, and a credentialled
     * entry rode its password through all three beside the carefully
     * sanitised error (Security review, 2026-09-24).
     *
     * Stripped, not shortened. This url is also the KEY the unread list is
     * built from, which the site looks up against the dataset's own source
     * urls — so it must stay the entry's address exactly, minus the one thing
     * that may not be printed. Making it readable is the printer's job, and
     * `printableAddress` is where that happens.
     */
    const base: Pick<WatchReport, "id" | "url" | "strategy" | "kind" | "note"> = {
      id: entry.id, url: addressWithoutCredentials(entry.url), strategy: entry.strategy, kind: entry.kind, note: entry.note,
    };

    if (!STRATEGIES[entry.strategy].fetches) {
      const age = entry.last_verified ? daysSince(entry.last_verified, today) : Infinity;
      return { ...base, outcome: age > (entry.max_age_days ?? 90) ? "reminder-due" : "ok" };
    }

    // A run given no browser reader has not opened these pages, and says so
    // rather than skipping them: an omitted reader is the same fact as a
    // missing Chrome, and both have to be red. The CLI always passes one, and
    // that one answers with Chrome's own absence when there is no Chrome.
    const fetched = entry.strategy === "browser"
      ? openInBrowser
        ? await openInBrowser(entry, STRATEGIES[entry.strategy].redirects)
        : {
          ok: false as const,
          error: "no browser reader: this run was given none, so the page was never opened",
          // Our own gap, not the source's minute: a run that brought no
          // browser will not have one three minutes later either.
          failure: "refused-by-us" as const,
        }
      : await fetcher(entry.url, STRATEGIES[entry.strategy].redirects);
    if (!fetched.ok) {
      // A blocked or failed fetch must never read as "no change".
      return { ...base, outcome: "unreachable", error: fetched.error, failure: fetched.failure };
    }
    // Nor may an empty one. EUR-Lex answers this fetcher HTTP 202 with no
    // body, and `ok` is true for 202: the pass hashed nothing, wrote a blank
    // snapshot and would have reported "unchanged" for ever after. The CLI's
    // own fetcher refuses it too, and this is the floor under every fetcher —
    // a test's, a future host's — because a reading nobody can read is not one
    // (Standards review, 2026-09-10).
    if (fetched.body.byteLength === 0) {
      // Transient: EUR-Lex's challenge answers exactly this way and the page
      // is there a minute later, which is the whole of what transient means.
      return { ...base, outcome: "unreachable", error: "the response carried an empty body", failure: "transient" };
    }

    // A learn link backs no value, so its wording may change freely — what
    // matters is that a person who clicks it arrives somewhere. Hashing it
    // would raise a flag every time an unrelated paragraph moved, and the
    // flag that cries every week is the flag nobody reads. Only silence is
    // news here, and silence is already reported above.
    if (!STRATEGIES[entry.strategy].compares) {
      return { ...base, outcome: "ok" };
    }

    let reading: Reading;
    try {
      reading = readSource(entry, fetched.body);
    } catch (e) {
      // One mangled page must not kill the whole pass (review finding #7).
      // The source's failure, not ours and not a hiccup: a slice marker that
      // is no longer on the page, or a PDF that no longer decodes, is the
      // page having changed under us, and reading it again changes nothing.
      return { ...base, outcome: "unreachable", error: `processing: ${String(e)}`, failure: "refused-by-source" };
    }

    const { hash, text } = reading;
    const prev = state.entries[entry.id];
    if (!prev) {
      nextEntries[entry.id] = { ...snapshotOf(reading, today, entry), history: [] };
      return { ...base, outcome: "baseline", new_hash: hash };
    }
    if (prev.hash === hash) {
      // The reading stands, and this run just confirmed it through today's
      // slice: the date the value was first seen does not move, the record of
      // what it was read through does.
      const slice = sliceFingerprint(entry);
      if (slice !== prev.slice_read) {
        const { slice_read: _dropped, ...rest } = prev;
        nextEntries[entry.id] = { ...rest, ...(slice ? { slice_read: slice } : {}) };
      }
      return { ...base, outcome: "unchanged", old_hash: prev.hash, new_hash: hash };
    }
    nextEntries[entry.id] = {
      ...snapshotOf(reading, today, entry),
      history: [...prev.history, { hash: prev.hash, retrieved_at: prev.retrieved_at }],
    };
    return {
      ...base, outcome: "changed", old_hash: prev.hash, new_hash: hash,
      context: text !== undefined && prev.text !== undefined ? diffContext(prev.text, text) : undefined,
    };
  };

  // The pass: every entry, in the watchlist's order, once.
  const reports: WatchReport[] = [];
  for (const entry of watchlist.entries) reports.push(await judge(entry));

  /**
   * The second try — after the LAST source of the first pass, never beside
   * the failure that earned it.
   *
   * The gap IS the rest of the pass, about three minutes on the runner, and
   * that gap is the only thing that makes a second read worth anything: a
   * retry taken where the failure happened asks the same second over again.
   * One more go, the same reader, the same budget; a second answer replaces
   * the first report entirely and a second failure stands. Refusals are not
   * here: the source's answer will not change in three minutes, and ours
   * must not.
   *
   * `reports[i]` is `watchlist.entries[i]` — the pass writes exactly one
   * report per entry, in order — so the retry replaces a report in place and
   * what a curator reads stays in the watchlist's order.
   */
  for (const [i, report] of reports.entries()) {
    if (report.outcome !== "unreachable" || report.failure !== "transient") continue;
    reports[i] = await judge(watchlist.entries[i]!);
  }

  const nextState: WatchState = {
    entries: nextEntries,
    last_run: today,
    // What the run could not read, from the reports it just wrote — not from
    // a flag an arm has to remember to raise. It is the one fact about a pass
    // that the entries cannot carry: an unreachable source leaves the
    // previous snapshot standing, and so does a source that answered and had
    // not changed. The list is written on a clean day too, empty, because
    // "nothing went unread" is a claim worth having on disk (s11).
    unread: unreadSince(reports, state, today),
  };
  // The run's own verdict, made here from what the run just learned: the CLI
  // reads it rather than working the same question out a second time from a
  // state it would have to compare against the one it started with.
  return { reports, nextState, verdict: verdictOf(reports, nextState, state) };
}

/**
 * The sources this run did not read, each with the day it started.
 *
 * `since` is what tells a hiccup from an outage, and it is decided HERE
 * because this is the one place holding both lists: what the last run could
 * not read and what this one could not. A source already on the previous list
 * keeps the day it was first missed; one that was not starts today; one that
 * answered drops off, and its day with it.
 *
 * A previous list written before s35 carries no day at all. The source was
 * still unread on that run — that is what being on the list means - so the
 * earliest day this run can honestly claim for it is the day that run
 * happened, and it reads as the outage it is rather than starting over.
 */
function unreadSince(reports: WatchReport[], previous: WatchState, today: string): UnreadEntry[] {
  const started = new Map(
    (previous.unread ?? []).map((u) => [u.id, u.since ?? previous.last_run ?? today] as const),
  );
  return reports
    .filter((r) => r.outcome === "unreachable")
    .map((r) => ({ id: r.id, url: r.url, since: started.get(r.id) ?? today }));
}

/** What a run came to, beyond its reports — the three words and the colour. */
export interface RunVerdict {
  /** Unread today and not on the run before: one day of grace, and green. */
  lapsed: UnreadEntry[];
  /** Unread today and unread then too. Red. */
  outages: UnreadEntry[];
  /** Refused by us on its first day: red the same morning, because waiting a
   * day changes nothing about an address this watch will not request. */
  refused: UnreadEntry[];
  /** Whether the run is red - the exit code, decided once, here. */
  red: boolean;
}

/**
 * What the run's unread sources mean, and whether the day is red.
 *
 * One place, so that the workflow never learns to count and the CLI never
 * re-derives it: the exit code stays the one signal the workflow reads, and
 * this is what decides it. Every unread source gets exactly one of the three
 * words, so the counts on the run's last line add up to `unreachable`.
 *
 * A source unread on the run before is an outage whatever failed this time —
 * two silent mornings in a row is the fact, and the reason may well have
 * changed between them.
 */
export function verdictOf(reports: WatchReport[], next: WatchState, previous: WatchState): RunVerdict {
  const before = new Set((previous.unread ?? []).map((u) => u.id));
  const failure = new Map(reports.map((r) => [r.id, r.failure] as const));
  const lapsed: UnreadEntry[] = [];
  const outages: UnreadEntry[] = [];
  const refused: UnreadEntry[] = [];
  for (const source of next.unread ?? []) {
    if (before.has(source.id)) outages.push(source);
    else if (failure.get(source.id) === "refused-by-us") refused.push(source);
    else lapsed.push(source);
  }
  return { lapsed, outages, refused, red: outages.length > 0 || refused.length > 0 };
}

/** One unread source, as the run says it out loud. */
export interface UnreadNotice {
  level: "warn" | "error";
  event: "lapse" | "outage" | "refused";
  id: string;
  url: string;
  /** The day this source first went unread. */
  since: string;
  /** The day of this run — the second of an outage's two dates. */
  today: string;
}

/**
 * What the run says about each source it did not read, and how loudly.
 *
 * A lapse is a warning: the site already tells a reader the run did not reach
 * it, and the morning is not one anybody has to act on. An outage and a
 * refusal are errors, because both are red and both are somebody's to fix.
 */
export function unreadNotices(verdict: RunVerdict, today: string): UnreadNotice[] {
  const say = (event: UnreadNotice["event"], level: UnreadNotice["level"]) =>
    (u: UnreadEntry): UnreadNotice => ({ level, event, id: u.id, url: u.url, since: u.since ?? today, today });
  return [
    ...verdict.lapsed.map(say("lapse", "warn")),
    ...verdict.outages.map(say("outage", "error")),
    ...verdict.refused.map(say("refused", "error")),
  ];
}

/** The numbers the run's last line carries. */
export interface RunSummary {
  total: number;
  changed: number;
  unreachable: number;
  lapsed: number;
  outages: number;
  refused: number;
}

/**
 * The run in six numbers, so a green day with a lapse is visible in the log
 * and not only in the state — and so the three words add up to `unreachable`
 * rather than leaving a reader to guess which bucket the rest fell in.
 */
export function runSummary(reports: WatchReport[], verdict: RunVerdict): RunSummary {
  return {
    total: reports.length,
    changed: reports.filter((r) => r.outcome === "changed").length,
    unreachable: reports.filter((r) => r.outcome === "unreachable").length,
    lapsed: verdict.lapsed.length,
    outages: verdict.outages.length,
    refused: verdict.refused.length,
  };
}

/**
 * What a `--only` pass leaves behind, merged onto the state the last full run
 * wrote.
 *
 * A targeted re-baseline is not a run of the watch: it fetches one entry, so it
 * must not stamp the day every source was last re-read — that date is a claim
 * about all of them (Standards review, 2026-09-08). The unread list travels
 * with that date for the same reason, with one exception, which is the whole
 * point of this function: the pass DID learn whether the entry it fetched
 * answered. Keeping the last run's verdict on an entry this pass has just
 * re-read would leave `/data/` saying a source has not answered since the very
 * day it was read — and re-baselining an entry after moving its slice marker is
 * a step CONTRIBUTING documents, so the lie would be a routine one (Standards
 * review, 2026-09-15).
 *
 * A state that has never carried an unread list does not gain an empty one
 * here: silence is what it claims, and a `--only` pass has learned nothing
 * about the sources it did not fetch.
 */
export function mergeTargetedRun(previous: WatchState, pass: WatchState, fetched: Watchlist): WatchState {
  const touched = new Set(fetched.entries.map((e) => e.id));
  const unread = [
    ...(previous.unread ?? []).filter((e) => !touched.has(e.id)),
    ...(pass.unread ?? []),
  ];
  return {
    entries: { ...previous.entries, ...pass.entries },
    last_run: previous.last_run,
    ...(previous.unread || unread.length ? { unread } : {}),
  };
}

/**
 * The "find out yourself" links. They back no value, so the quote gate has
 * nothing to say about them — but they are a promise to the one person who
 * answered "I don't know", and a dead one strands exactly them. Verified by
 * hand once at s3; unwatched until 2026-09-06, when the human found the German
 * statute link unreachable from Türkiye and nothing had noticed.
 */
export function datasetLearnUrls(dataset: Dataset): Set<string> {
  const urls = new Set<string>();
  for (const f of dataset.fields) if (f.learn) urls.add(f.learn.url);
  // A notice hands the reader a page too, and it is the same promise to the
  // same person: the Algerian notice's link is the one page on the site
  // written for the reader it fires on, and a dead one strands exactly them.
  for (const n of dataset.notices ?? []) if (n.learn) urls.add(n.learn.url);
  return urls;
}

export interface CoverageResult {
  ok: boolean;
  missing_from_watchlist: string[];
  orphan_watch_entries: string[];
  /** Declared glyph corrections that are not corrections: the bound in
   * `corrections.ts` is what stops a substitution writing content into a
   * source, so breaking it fails the gate rather than being skipped quietly. */
  unbounded_substitutions: string[];
  /** Declared browser steps the vocabulary does not contain, or that carry no
   * label to act on. A step nothing can perform would read as a step that
   * quietly did nothing, and the page would then be read in a state nobody
   * chose — so it fails the gate here, before a run can. */
  invalid_steps: string[];
  /**
   * Watched addresses carrying a name and password.
   *
   * No source this project reads needs one, and a watch that sends
   * credentials is a watch that can leak them — into an error, a log, a flag
   * and an issue. Both readers refuse such an address at run time; this
   * refuses it in the watchlist, where it is curator data and where a person
   * can fix it before a morning does (s34, 2026-09-24).
   */
  urls_with_credentials: string[];
  /**
   * Value sources on a strategy that never compares.
   *
   * A `value-source` promises that a dataset sentence rests on this page; a
   * `compares: false` strategy promises only that something answered. Put
   * together they make a quiet lie: the run reports `ok` whatever the source
   * now says, the snapshot the quote gate checks against is never refreshed
   * so the sentence stays "verified" against a reading nothing is renewing,
   * and — since s34 — the entry moves onto the redirect policy written for
   * links, which follows off the site. Flipping an entry to `link` should be
   * a decision somebody defends, not a switch that goes quiet (s34,
   * 2026-09-25).
   */
  unchecked_value_sources: string[];
}

/**
 * Why this declared step is not one — or `null` when it is.
 *
 * It reads the entry's JSON as the unknown it is: a watchlist is hand-edited,
 * and TypeScript has nothing to say about a file read at run time.
 */
function invalidStepReason(step: unknown): string | null {
  if (typeof step !== "object" || step === null || Array.isArray(step))
    return "a step is an object naming what to do";
  const fields = step as Record<string, unknown>;
  const name = fields["step"];
  if (typeof name !== "string" || !(name in STEP_SHAPES))
    return `"${String(name)}" is not one of ${Object.keys(STEP_SHAPES).join(", ")}`;
  for (const required of STEP_SHAPES[name as WatchStep["step"]]) {
    const value = fields[required];
    if (typeof value !== "string" || !value.trim())
      return `${name} needs a ${required} to act on`;
  }
  if (name === "answer" && fields["answer"] !== "yes" && fields["answer"] !== "no")
    return `answer is "yes" or "no", not "${String(fields["answer"])}"`;
  return null;
}

/** Every quote the dataset ships, with the source it claims to come from. */
export function datasetQuotes(dataset: Dataset): { quote: string; source_url: string; where: string }[] {
  const out: { quote: string; source_url: string; where: string }[] = [];
  for (const country of dataset.countries)
    for (const route of country.routes) {
      forEachCriterion(route.criteria, (c) => {
        for (const p of provenancedValuesOf(c))
          out.push({ quote: p.value.quote, source_url: p.value.source_url, where: route.id });
      });
      for (const s of routeStatements(route))
        for (const value of statementSources(s))
          out.push({ quote: value.quote, source_url: value.source_url, where: `${route.id}:${s.id}` });
    }
  for (const n of dataset.notices ?? [])
    for (const value of noticeSources(n))
      out.push({ quote: value.quote, source_url: value.source_url, where: `notice:${n.id}` });
  if (usesCountryVocabulary(dataset))
    for (const [id, cls] of Object.entries(countryVocabulary.classes))
      for (const source of cls.sources ?? [])
        out.push({ quote: source.quote, source_url: source.source_url, where: `class:${id}` });
  return out;
}

/**
 * Compare a quote with page text without letting our own extraction decide the
 * verdict: tag stripping can swallow a space ("45.630Euro") or add one before
 * punctuation ("in the EU ."). Everything else must match character for
 * character — this is the check that keeps a quote a quote.
 */
function loose(s: string, operatorSpacing = false): string {
  let out = s
    .replace(/​/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\d)(?=[A-Za-zÀ-ÿ])/g, "$1 ")
    .replace(/([A-Za-zÀ-ÿ€])(?=\d)/g, "$1 ")
    .replace(/\s+([.,;:])/g, "$1");
  // One further tolerance, for decoded PDFs ONLY: a document positions "1."
  // and "091" as two separate showing operators, and the decoder puts a space
  // between operators because that is where words break. Inside a number it
  // never is one — "1. 091" is our spacing, "1.091" is the page's. An html
  // page has no showing operators, so applying this there would forgive a
  // difference that is really in the page (review 2026-09-07).
  if (operatorSpacing) out = out.replace(/(\d[.,]) (?=\d)/g, "$1");
  return out.trim();
}

export interface QuoteCheckResult {
  ok: boolean;
  /** Quotes no longer found in the snapshot of the source they cite. */
  missing: { where: string; source_url: string; quote: string }[];
  /** Sources with no text snapshot to check against (pdf tier, human tier,
   * or never fetched) — reported, never silently counted as verified. The
   * quote travels with them: a checklist that named only the route would leave
   * a person holding a PDF wondering which sentence they came to find (s5e). */
  unverifiable: { where: string; source_url: string; quote: string; reason: string }[];
  verified: number;
}

/**
 * The promise is not "we noticed the page changed" but "this sentence is on
 * that page". A hash says something moved; only this says the quoted value is
 * still there — so a reworded page that keeps its bytes-count, or an edit our
 * curation missed, cannot pass quietly.
 */
export function checkQuotes(dataset: Dataset, watchlist: Watchlist, state: WatchState): QuoteCheckResult {
  const byUrl = new Map(watchlist.entries.map((e) => [e.url, e]));
  const missing: QuoteCheckResult["missing"] = [];
  const unverifiable: QuoteCheckResult["unverifiable"] = [];
  let verified = 0;
  for (const q of datasetQuotes(dataset)) {
    const entry = byUrl.get(q.source_url);
    if (!entry) {
      unverifiable.push({ ...q, reason: "source not on the watchlist" });
      continue;
    }
    const snapshot = state.entries[entry.id];
    if (!snapshot?.text) {
      // The human tier is not a gap in the gate, it is the gate's honest
      // answer: the page renders client-side, a person read it, and no machine
      // here can confirm the sentence. Saying so beats a silent pass — and
      // what each strategy's honest answer IS lives with the strategy.
      unverifiable.push({
        ...q,
        reason: snapshot?.unverifiable_reason
          // The one answer a text strategy may give about a document it found
          // no words in, in the dataset's own word for it. Anything else would
          // put a machine's guess at a photograph behind a sentence the reader
          // is told was quoted.
          ? `${snapshot.unverifiable_reason} — the document is a picture of a page, with no text layer to read`
          : STRATEGIES[entry.strategy].no_text_snapshot,
      });
      continue;
    }
    // Where a decoder is known to be wrong about a source, it is wrong BY
    // NAME: the correction is declared on the watch entry beside the source,
    // bounded to a glyph run of the same length, applied to the snapshot for
    // the comparison only, and never written into what the dataset ships.
    const operatorSpacing = entry.strategy === "pdf-text";
    const page = repairKnownGlyphs(entry.glyph_substitutions, snapshot.text);
    if (loose(page, operatorSpacing).includes(loose(q.quote, operatorSpacing))) verified++;
    else missing.push(q);
  }
  return { ok: missing.length === 0, missing, unverifiable, verified };
}

/** Coverage is enforced, not promised: every dataset source is watched, and
 * every value-source watch entry still backs a dataset value. */
export function checkCoverage(dataset: Dataset, watchlist: Watchlist): CoverageResult {
  const datasetUrls = datasetSourceUrls(dataset);
  const watchedUrls = new Set(watchlist.entries.map((e) => e.url));
  // Learn links join the required set; they never join the value set, so a
  // watch entry for one is a sentinel and cannot be orphaned by it.
  const required = new Set([...datasetUrls, ...datasetLearnUrls(dataset)]);
  const missing = [...required].filter((u) => !watchedUrls.has(u));
  const orphans = watchlist.entries
    .filter((e) => e.kind === "value-source" && !datasetUrls.has(e.url))
    .map((e) => e.id);
  const unbounded = watchlist.entries.flatMap((e) =>
    (e.glyph_substitutions ?? []).flatMap((sub) => {
      const why = unboundedReason(sub);
      return why === null ? [] : [`${e.id}: "${sub.from}" → "${sub.to}" — ${why}`];
    }));
  const steps = watchlist.entries.flatMap((e) => {
    if (!e.steps?.length) return [];
    // Only a browser opens a page, so only a browser entry can perform one.
    // Steps on any other strategy are silently ignored at run time, which is
    // the worst of the two ways to be wrong about them.
    if (e.strategy !== "browser")
      return [`${e.id}: steps are declared on a ${e.strategy} entry, which opens no browser`];
    return e.steps.flatMap((step, i) => {
      const why = invalidStepReason(step);
      return why === null ? [] : [`${e.id}: step ${i + 1} — ${why}`];
    });
  });
  const credentialled = watchlist.entries.flatMap((e) => {
    /**
     * The entry is named; the address never is, beyond its origin.
     *
     * This is the one place in this file that handles a string chosen to be
     * withheld, so it prints as little of it as it can. Both branches were
     * wrong at first: the failure branch printed the raw url — the very
     * string that may carry the name and password this field exists to keep
     * out of the log — and `new URL("://watcher:hunter2@host/")` throws, so
     * that was the likely path for one to arrive by; and the success branch
     * printed the whole pathname, which is the page's to choose and so
     * unbounded (Security review, 2026-09-24). A curator has the entry id,
     * which is what they edit the watchlist by.
     */
    let parsed: URL;
    try { parsed = new URL(e.url); } catch { return [`${e.id}: its url is not an address`]; }
    return parsed.username || parsed.password
      ? [`${e.id}: ${shortAddress(parsed.origin)} carries a name and password`]
      : [];
  });
  // Keyed on what the DATASET cites, not on what the entry calls itself: an
  // entry flipped to `link` and `sentinel` in one edit would otherwise pass
  // both this and the orphan check while a shipped sentence went on resting
  // on a snapshot nothing refreshes (Security review, 2026-09-25).
  const unchecked = watchlist.entries
    .filter((e) => (datasetUrls.has(e.url) || e.kind === "value-source")
      && STRATEGIES[e.strategy].fetches && !STRATEGIES[e.strategy].compares)
    .map((e) => `${e.id}: ${datasetUrls.has(e.url) ? "a dataset value rests on it" : "it is declared a value-source"}`
      + `, and the ${e.strategy} strategy fetches but never compares`);
  return {
    ok: missing.length === 0 && orphans.length === 0 && unbounded.length === 0
      && steps.length === 0 && credentialled.length === 0 && unchecked.length === 0,
    missing_from_watchlist: missing,
    orphan_watch_entries: orphans,
    unbounded_substitutions: unbounded,
    invalid_steps: steps,
    urls_with_credentials: credentialled,
    unchecked_value_sources: unchecked,
  };
}
