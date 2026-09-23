import { createHash } from "node:crypto";
import { htmlToText, normalize } from "./normalize.js";
import { pdfToText } from "./pdf-text.js";
import { repairKnownGlyphs, unboundedReason, type GlyphSubstitution } from "./corrections.js";
import { noticeSources, provenancedValuesOf, routeStatements, statementSources, forEachCriterion } from "../engine.js";
import { countryVocabulary } from "../countries.js";
import { datasetSourceUrls, usesCountryVocabulary, type Snapshot, type WatchState } from "./state.js";
import type { Dataset, UnsourcedReasonWord } from "../types.js";

/**
 * The state's own shape, and the derivations over it, live in `state.ts` — the
 * site reads them too, and nothing there may reach a Node built-in. This file
 * is what WRITES the state; it passes on only the two names its own callers
 * have always asked it for, so the module that writes the state does not
 * become a second door onto everything that reads it.
 */
export { datasetSourceUrls } from "./state.js";
export type { Snapshot, WatchState } from "./state.js";

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
export const STRATEGIES: Record<WatchStrategy, {
  /** Whether a pass fetches the source at all. */
  fetches: boolean;
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
    fetches: true, compares: true,
    no_text_snapshot: "html tier — no text snapshot; the source has not been fetched yet",
    remediation: "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  browser: {
    // html's twin: everything downstream of the reading is html's, because the
    // difference is the reader and nothing else. What comes back is the page a
    // person sees rather than the shell a `fetch` is handed, so the words a
    // curator is sent to fix are the same words, found the same way.
    fetches: true, compares: true,
    no_text_snapshot: "browser tier — no text snapshot; no browser has opened the page yet",
    remediation: "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  "pdf-text": {
    fetches: true, compares: true,
    no_text_snapshot: "pdf-text tier — no text snapshot; the source has not been fetched yet",
    remediation: "The PDF's WORDS changed, not just its bytes. Read the diff context below, then update the dataset value(s) with quote + retrieval date; move the old value into history.",
  },
  pdf: {
    fetches: true, compares: true,
    no_text_snapshot: "pdf tier — the bytes are watched; nothing here reads the document's words",
    remediation: "PDF changed — a human must read it; no value is extracted automatically.",
  },
  link: {
    fetches: true, compares: false,
    no_text_snapshot: "link tier — a learn link backs no value, so no quote rests on it",
    remediation: "A learn link backs no value; only silence is news here.",
  },
  human: {
    fetches: false, compares: false,
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
  | { ok: true; body: Uint8Array }
  | { ok: false; status?: number; error: string };
export type Fetcher = (url: string) => Promise<FetchResult>;

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
export type BrowserReader = (entry: WatchEntry) => Promise<FetchResult>;

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
): Promise<{ reports: WatchReport[]; nextState: WatchState }> {
  const reports: WatchReport[] = [];
  const nextEntries: Record<string, Snapshot> = { ...state.entries };

  for (const entry of watchlist.entries) {
    const base: Pick<WatchReport, "id" | "url" | "strategy" | "kind" | "note"> = {
      id: entry.id, url: entry.url, strategy: entry.strategy, kind: entry.kind, note: entry.note,
    };

    if (!STRATEGIES[entry.strategy].fetches) {
      const age = entry.last_verified ? daysSince(entry.last_verified, today) : Infinity;
      reports.push({ ...base, outcome: age > (entry.max_age_days ?? 90) ? "reminder-due" : "ok" });
      continue;
    }

    // A run given no browser reader has not opened these pages, and says so
    // rather than skipping them: an omitted reader is the same fact as a
    // missing Chrome, and both have to be red. The CLI always passes one, and
    // that one answers with Chrome's own absence when there is no Chrome.
    const fetched = entry.strategy === "browser"
      ? openInBrowser
        ? await openInBrowser(entry)
        : { ok: false as const, error: "no browser reader: this run was given none, so the page was never opened" }
      : await fetcher(entry.url);
    if (!fetched.ok) {
      // A blocked or failed fetch must never read as "no change".
      reports.push({ ...base, outcome: "unreachable", error: fetched.error });
      continue;
    }
    // Nor may an empty one. EUR-Lex answers this fetcher HTTP 202 with no
    // body, and `ok` is true for 202: the pass hashed nothing, wrote a blank
    // snapshot and would have reported "unchanged" for ever after. The CLI's
    // own fetcher refuses it too, and this is the floor under every fetcher —
    // a test's, a future host's — because a reading nobody can read is not one
    // (Standards review, 2026-09-10).
    if (fetched.body.byteLength === 0) {
      reports.push({ ...base, outcome: "unreachable", error: "the response carried an empty body" });
      continue;
    }

    // A learn link backs no value, so its wording may change freely — what
    // matters is that a person who clicks it arrives somewhere. Hashing it
    // would raise a flag every time an unrelated paragraph moved, and the
    // flag that cries every week is the flag nobody reads. Only silence is
    // news here, and silence is already reported above.
    if (!STRATEGIES[entry.strategy].compares) {
      reports.push({ ...base, outcome: "ok" });
      continue;
    }

    let reading: Reading;
    try {
      reading = readSource(entry, fetched.body);
    } catch (e) {
      // One mangled page must not kill the whole pass (review finding #7).
      reports.push({ ...base, outcome: "unreachable", error: `processing: ${String(e)}` });
      continue;
    }

    const { hash, text } = reading;
    const prev = state.entries[entry.id];
    if (!prev) {
      reports.push({ ...base, outcome: "baseline", new_hash: hash });
      nextEntries[entry.id] = { ...snapshotOf(reading, today, entry), history: [] };
    } else if (prev.hash === hash) {
      reports.push({ ...base, outcome: "unchanged", old_hash: prev.hash, new_hash: hash });
      // The reading stands, and this run just confirmed it through today's
      // slice: the date the value was first seen does not move, the record of
      // what it was read through does.
      const slice = sliceFingerprint(entry);
      if (slice !== prev.slice_read) {
        const { slice_read: _dropped, ...rest } = prev;
        nextEntries[entry.id] = { ...rest, ...(slice ? { slice_read: slice } : {}) };
      }
    } else {
      reports.push({
        ...base, outcome: "changed", old_hash: prev.hash, new_hash: hash,
        context: text !== undefined && prev.text !== undefined ? diffContext(prev.text, text) : undefined,
      });
      nextEntries[entry.id] = {
        ...snapshotOf(reading, today, entry),
        history: [...prev.history, { hash: prev.hash, retrieved_at: prev.retrieved_at }],
      };
    }
  }

  return {
    reports,
    nextState: {
      entries: nextEntries,
      last_run: today,
      // What the run could not read, from the reports it just wrote — not from
      // a flag an arm has to remember to raise. It is the one fact about a pass
      // that the entries cannot carry: an unreachable source leaves the
      // previous snapshot standing, and so does a source that answered and had
      // not changed. The list is written on a clean day too, empty, because
      // "nothing went unread" is a claim worth having on disk (s11).
      unread: reports.filter((r) => r.outcome === "unreachable").map((r) => ({ id: r.id, url: r.url })),
    },
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
  return {
    ok: missing.length === 0 && orphans.length === 0 && unbounded.length === 0 && steps.length === 0,
    missing_from_watchlist: missing,
    orphan_watch_entries: orphans,
    unbounded_substitutions: unbounded,
    invalid_steps: steps,
  };
}
