import { createHash } from "node:crypto";
import { htmlToText, normalize } from "./normalize.js";
import type { Criterion, Dataset } from "../types.js";

export type WatchStrategy = "html" | "pdf" | "human";

export interface WatchEntry {
  id: string;
  url: string;
  strategy: WatchStrategy;
  /** value-source entries must back dataset values; sentinels (edition
   * indexes, official-recheck reminders) are allowed to stand alone. */
  kind: "value-source" | "sentinel";
  note?: string;
  /** human strategy only */
  max_age_days?: number;
  last_verified?: string; // YYYY-MM-DD
}

export interface Watchlist { entries: WatchEntry[] }

export interface Snapshot {
  hash: string;
  retrieved_at: string;
  /** normalized text kept for html entries so a change can quote its diff context */
  text?: string;
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

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
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
    const base: Pick<WatchReport, "id" | "url" | "strategy"> = {
      id: entry.id, url: entry.url, strategy: entry.strategy,
    };

    if (entry.strategy === "human") {
      const age = entry.last_verified ? daysBetween(entry.last_verified, today) : Infinity;
      reports.push({ ...base, outcome: age > (entry.max_age_days ?? 90) ? "reminder-due" : "ok" });
      continue;
    }

    const fetched = await fetcher(entry.url);
    if (!fetched.ok) {
      // A blocked or failed fetch must never read as "no change".
      reports.push({ ...base, outcome: "unreachable", error: fetched.error });
      continue;
    }

    let hash: string;
    let text: string | undefined;
    if (entry.strategy === "pdf") {
      hash = sha256(fetched.body);
    } else {
      text = normalize(htmlToText(new TextDecoder("utf-8").decode(fetched.body)));
      hash = sha256(text);
    }

    const prev = state.entries[entry.id];
    if (!prev) {
      reports.push({ ...base, outcome: "baseline", new_hash: hash });
      nextEntries[entry.id] = { hash, retrieved_at: today, text, history: [] };
    } else if (prev.hash === hash) {
      reports.push({ ...base, outcome: "unchanged", old_hash: prev.hash, new_hash: hash });
    } else {
      reports.push({
        ...base, outcome: "changed", old_hash: prev.hash, new_hash: hash,
        context: text !== undefined && prev.text !== undefined ? diffContext(prev.text, text) : undefined,
      });
      nextEntries[entry.id] = {
        hash, retrieved_at: today, text,
        history: [...prev.history, { hash: prev.hash, retrieved_at: prev.retrieved_at }],
      };
    }
  }

  return { reports, nextState: { entries: nextEntries } };
}

/** Every provenanced source_url in the dataset. */
export function datasetSourceUrls(dataset: Dataset): Set<string> {
  const urls = new Set<string>();
  const walk = (c: Criterion): void => {
    if (c.op === "gte") urls.add(c.threshold.source_url);
    if (c.op === "points") { urls.add(c.required.source_url); urls.add(c.table.source_url); }
    if (c.op === "any") for (const p of c.paths) p.criteria.forEach(walk);
  };
  for (const country of dataset.countries)
    for (const route of country.routes) route.criteria.forEach(walk);
  return urls;
}

export interface CoverageResult {
  ok: boolean;
  missing_from_watchlist: string[];
  orphan_watch_entries: string[];
}

/** Coverage is enforced, not promised: every dataset source is watched, and
 * every value-source watch entry still backs a dataset value. */
export function checkCoverage(dataset: Dataset, watchlist: Watchlist): CoverageResult {
  const datasetUrls = datasetSourceUrls(dataset);
  const watchedUrls = new Set(watchlist.entries.map((e) => e.url));
  const missing = [...datasetUrls].filter((u) => !watchedUrls.has(u));
  const orphans = watchlist.entries
    .filter((e) => e.kind === "value-source" && !datasetUrls.has(e.url))
    .map((e) => e.id);
  return { ok: missing.length === 0 && orphans.length === 0, missing_from_watchlist: missing, orphan_watch_entries: orphans };
}
