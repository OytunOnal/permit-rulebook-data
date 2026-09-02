import { createHash } from "node:crypto";
import { htmlToText, normalize } from "./normalize.js";
import { forEachCriterion, provenancedValuesOf } from "../engine.js";
import type { Dataset } from "../types.js";

export type WatchStrategy = "html" | "pdf" | "human";

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

    let hash: string;
    let text: string | undefined;
    try {
      if (entry.strategy === "pdf") {
        hash = sha256(fetched.body);
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

/** Every provenanced source_url in the dataset — via the single exhaustive
 * criterion walk, so a new op cannot silently escape the coverage gate. */
export function datasetSourceUrls(dataset: Dataset): Set<string> {
  const urls = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        for (const p of provenancedValuesOf(c)) urls.add(p.value.source_url);
      });
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
