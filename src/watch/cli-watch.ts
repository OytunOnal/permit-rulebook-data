import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runWatch, STRATEGIES, type Fetcher, type WatchReport, type WatchState, type Watchlist } from "./core.js";

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));

const commit = process.argv.includes("--commit");
/**
 * `--only=<id>` runs one entry and leaves every other snapshot untouched.
 *
 * A curator who moves a slice marker on purpose has to re-baseline that entry
 * and only that entry: running all thirty would rewrite thirty snapshots and
 * bury the one deliberate change among them. The daily run passes no filter
 * and is unaffected.
 */
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg?.slice("--only=".length);
const watchlist = readJson(new URL("../../../watch/watchlist.json", import.meta.url)) as Watchlist;
const statePath = new URL("../../../watch/state.json", import.meta.url);
const state = readJson(statePath) as WatchState;

if (only) {
  const wanted = watchlist.entries.filter((e) => e.id === only);
  if (!wanted.length) {
    log("error", "no such watch entry", { id: only });
    process.exit(2);
  }
  watchlist.entries = wanted;
}

const fetcher: Fetcher = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "permit-rulebook-watch/0.1 (+https://github.com/OytunOnal/permit-rulebook-data) change-detection" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, body: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

/**
 * What a curator does about this flag. The advice per strategy lives in one
 * table in core.ts — this arm used to name only `pdf`, so a `pdf-text` entry
 * whose WORDS moved was told to update the dataset as if it were a web page
 * (review 2026-09-07). What a sentinel means is the exception, because it is
 * about the entry's kind and not about how it is read.
 */
function remediation(report: WatchReport): string {
  if (report.kind === "sentinel" && report.outcome !== "reminder-due")
    return "Sentinel changed — it backs no dataset value directly. Read the source, act on the intent below, and extend the watchlist if new value pages appeared.";
  return STRATEGIES[report.strategy].remediation;
}

function flagFile(report: WatchReport, today: string) {
  const dir = new URL("../../../watch/flags/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const body = [
    `# Watch flag: ${report.id} — ${report.outcome}`,
    "",
    `- url: ${report.url}`,
    `- kind: ${report.kind}`,
    `- date: ${today}`,
    report.old_hash ? `- old: ${report.old_hash}` : "",
    report.new_hash ? `- new: ${report.new_hash}` : "",
    report.note ? `\nIntent: ${report.note}` : "",
    report.context ? `\n> …${report.context}…` : "",
    "",
    remediation(report),
  ].filter(Boolean).join("\n");
  // Reminders use a stable name (self-overwriting, no daily pile-up);
  // content changes keep the date so history stays visible.
  const name = report.outcome === "reminder-due" ? `${report.id}-reminder.md` : `${report.id}-${today}.md`;
  writeFileSync(new URL(name, dir), body + "\n");
}

const today = new Date().toISOString().slice(0, 10);
const { reports, nextState } = await runWatch(watchlist, state, fetcher, today);

let unreachable = 0;
for (const r of reports) {
  const level = r.outcome === "unreachable" ? "error" : r.outcome === "unchanged" || r.outcome === "ok" ? "info" : "warn";
  log(level, `watch:${r.outcome}`, { id: r.id, url: r.url, old: r.old_hash, new: r.new_hash, error: r.error });
  if (r.outcome === "unreachable") unreachable++;
  if (r.outcome === "changed" || r.outcome === "reminder-due") flagFile(r, today);
}

if (commit) {
  // With `--only`, every other entry's snapshot is carried over untouched: a
  // targeted re-baseline must not quietly drop the twenty-nine it did not fetch.
  const merged = only
    ? { entries: { ...state.entries, ...nextState.entries }, last_run: nextState.last_run }
    : nextState;
  writeFileSync(statePath, JSON.stringify(merged, null, 2) + "\n");
  log("info", "state committed", {
    entries: Object.keys(merged.entries).length, only: only ?? null, last_run: merged.last_run,
  });
} else {
  log("info", "dry run — state untouched (use --commit to persist)");
}

log(unreachable ? "error" : "info", "watch complete", {
  total: reports.length,
  changed: reports.filter((r) => r.outcome === "changed").length,
  unreachable,
});
process.exit(unreachable > 0 ? 1 : 0);
