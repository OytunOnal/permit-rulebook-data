import { createHash } from "node:crypto";
import { htmlToText, normalize } from "./normalize.js";
import { pdfToText, repairKnownGlyphs } from "./pdf-text.js";
import { forEachCriterion, provenancedValuesOf, routeStatements } from "../engine.js";
import { countryVocabulary } from "../countries.js";
import type { Dataset } from "../types.js";

export type WatchStrategy = "html" | "pdf" | "pdf-text" | "human" | "link";

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
  /** link strategy only: the field whose "find out yourself" link this is,
   * so a report says which question loses its help when the page goes. */
  learn_for?: string;
  /** human strategy only */
  max_age_days?: number;
  last_verified?: string; // YYYY-MM-DD
}

export interface Watchlist { entries: WatchEntry[] }

export interface Snapshot {
  /** What "changed" is decided on: the normalized text where a strategy can
   * read one, the file's own bytes where it cannot. */
  hash: string;
  retrieved_at: string;
  /** normalized text kept for html and pdf-text entries so a change can quote
   * its diff context — and so the quote gate has something to check against */
  text?: string;
  /** pdf-text only: the file's own hash, kept beside the words. The words are
   * what a change means; the bytes are what a re-export moves. */
  bytes_hash?: string;
  /** pdf-text only: the document carried no text layer on this read. Set so
   * the quote gate can say WHY it cannot check, and say the same thing twice
   * running rather than "never fetched". */
  no_text_layer?: boolean;
  history: { hash: string; retrieved_at: string }[];
}

export interface WatchState { entries: Record<string, Snapshot> }

export type FetchResult =
  | { ok: true; body: Uint8Array }
  | { ok: false; status?: number; error: string };
export type Fetcher = (url: string) => Promise<FetchResult>;

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
): Promise<{ reports: WatchReport[]; nextState: WatchState }> {
  const reports: WatchReport[] = [];
  const nextEntries: Record<string, Snapshot> = { ...state.entries };

  for (const entry of watchlist.entries) {
    const base: Pick<WatchReport, "id" | "url" | "strategy" | "kind" | "note"> = {
      id: entry.id, url: entry.url, strategy: entry.strategy, kind: entry.kind, note: entry.note,
    };

    if (entry.strategy === "human") {
      const age = entry.last_verified ? daysSince(entry.last_verified, today) : Infinity;
      reports.push({ ...base, outcome: age > (entry.max_age_days ?? 90) ? "reminder-due" : "ok" });
      continue;
    }

    const fetched = await fetcher(entry.url);
    if (!fetched.ok) {
      // A blocked or failed fetch must never read as "no change".
      reports.push({ ...base, outcome: "unreachable", error: fetched.error });
      continue;
    }

    // A learn link backs no value, so its wording may change freely — what
    // matters is that a person who clicks it arrives somewhere. Hashing it
    // would raise a flag every time an unrelated paragraph moved, and the
    // flag that cries every week is the flag nobody reads. Only silence is
    // news here, and silence is already reported above.
    if (entry.strategy === "link") {
      reports.push({ ...base, outcome: "ok" });
      continue;
    }

    let hash: string;
    let text: string | undefined;
    let bytesHash: string | undefined;
    let noTextLayer = false;
    try {
      if (entry.strategy === "pdf") {
        hash = sha256(fetched.body);
      } else if (entry.strategy === "pdf-text") {
        // The words decide, not the bytes: a ministry re-exporting the same
        // sheet moves every byte and no sentence, and a watch that cried
        // "changed" at that is a watch a curator learns to wave through.
        bytesHash = sha256(fetched.body);
        const decoded = pdfToText(fetched.body);
        if (decoded) {
          text = decoded.text;
          hash = sha256(text);
        } else {
          // A scan. There is nothing to read, so the bytes are all there is —
          // and the quote gate is told why, rather than left to guess.
          noTextLayer = true;
          hash = bytesHash;
        }
      } else {
        text = normalize(htmlToText(new TextDecoder("utf-8").decode(fetched.body)));
        if (entry.slice) {
          const from = text.indexOf(entry.slice.from);
          const to = from >= 0 ? text.indexOf(entry.slice.to, from + entry.slice.from.length) : -1;
          if (from < 0 || to < 0)
            throw new Error(`slice marker missing: ${from < 0 ? "from" : "to"}`);
          text = text.slice(from, to + entry.slice.to.length);
        }
        hash = sha256(text);
      }
    } catch (e) {
      // One mangled page must not kill the whole pass (review finding #7).
      reports.push({ ...base, outcome: "unreachable", error: `processing: ${String(e)}` });
      continue;
    }

    const prev = state.entries[entry.id];
    if (!prev) {
      reports.push({ ...base, outcome: "baseline", new_hash: hash });
      nextEntries[entry.id] = { hash, retrieved_at: today, text, ...(bytesHash ? { bytes_hash: bytesHash } : {}), ...(noTextLayer ? { no_text_layer: true } : {}), history: [] };
    } else if (prev.hash === hash) {
      reports.push({ ...base, outcome: "unchanged", old_hash: prev.hash, new_hash: hash });
    } else {
      reports.push({
        ...base, outcome: "changed", old_hash: prev.hash, new_hash: hash,
        context: text !== undefined && prev.text !== undefined ? diffContext(prev.text, text) : undefined,
      });
      nextEntries[entry.id] = {
        hash, retrieved_at: today, text,
        ...(bytesHash ? { bytes_hash: bytesHash } : {}),
        ...(noTextLayer ? { no_text_layer: true } : {}),
        history: [...prev.history, { hash: prev.hash, retrieved_at: prev.retrieved_at }],
      };
    }
  }

  return { reports, nextState: { entries: nextEntries } };
}

/** Does this dataset read the country vocabulary at all? */
function usesCountryVocabulary(dataset: Dataset): boolean {
  return dataset.fields.some((f) => f.options_from === "countries");
}

/** Every provenanced source_url in the dataset — via the single exhaustive
 * criterion walk, so a new op cannot silently escape the coverage gate. */
export function datasetSourceUrls(dataset: Dataset): Set<string> {
  const urls = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes) {
      forEachCriterion(route.criteria, (c) => {
        for (const p of provenancedValuesOf(c)) urls.add(p.value.source_url);
      });
      // A route statement rests on a quote like every other value.
      for (const s of routeStatements(route)) if (s.source) urls.add(s.source.source_url);
    }
  // A notice rests on a quote like every other value — it is watched like one.
  for (const n of dataset.notices ?? []) urls.add(n.source.source_url);
  // So does a passport class: its member list decides who needs a permit at
  // all, so every leg of that claim is watched like a threshold — but only for
  // a dataset that reads the vocabulary. Folding it in unconditionally made the
  // gate fail on a ruleset that never mentions a country (review).
  if (usesCountryVocabulary(dataset))
    for (const cls of Object.values(countryVocabulary.classes))
      for (const source of cls.sources ?? []) urls.add(source.source_url);
  return urls;
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
  return urls;
}

export interface CoverageResult {
  ok: boolean;
  missing_from_watchlist: string[];
  orphan_watch_entries: string[];
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
        if (s.source) out.push({ quote: s.source.quote, source_url: s.source.source_url, where: `${route.id}:${s.id}` });
    }
  for (const n of dataset.notices ?? [])
    out.push({ quote: n.source.quote, source_url: n.source.source_url, where: `notice:${n.id}` });
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
function loose(s: string): string {
  return s
    .replace(/​/g, "")
    .replace(/\s+/g, " ")
    .replace(/(\d)(?=[A-Za-zÀ-ÿ])/g, "$1 ")
    .replace(/([A-Za-zÀ-ÿ€])(?=\d)/g, "$1 ")
    .replace(/\s+([.,;:])/g, "$1")
    // The same tolerance, one level down, for a PDF: a document positions
    // "1." and "091" as two separate showing operators, and the decoder puts
    // a space between operators because that is where words break. Inside a
    // number it never is one — "1. 091" is our spacing, "1.091" is the page's.
    .replace(/(\d[.,]) (?=\d)/g, "$1")
    .trim();
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
      // here can confirm the sentence. Saying so beats a silent pass.
      unverifiable.push({
        ...q,
        reason: snapshot?.no_text_layer
          // The one answer a text strategy may give about a scan. Anything
          // else would put a machine's guess at a photograph behind a
          // sentence the reader is told was quoted.
          ? "no text layer — the document is a picture of a page"
          : entry.strategy === "human"
            ? "human tier — read by a person; no machine snapshot to check against"
            : `${entry.strategy} tier — no text snapshot`,
      });
      continue;
    }
    // Where a decoder is known to be wrong about a source, it is wrong BY
    // NAME: the substitution is declared per entry, applied to the snapshot
    // for the comparison only, and never written into what the dataset ships.
    if (loose(repairKnownGlyphs(entry.id, snapshot.text)).includes(loose(q.quote))) verified++;
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
  return { ok: missing.length === 0 && orphans.length === 0, missing_from_watchlist: missing, orphan_watch_entries: orphans };
}
