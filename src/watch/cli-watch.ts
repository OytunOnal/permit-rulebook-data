import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runWatch, type Fetcher, type WatchReport, type WatchState, type Watchlist } from "./core.js";

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));

const commit = process.argv.includes("--commit");
const watchlist = readJson(new URL("../../../watch/watchlist.json", import.meta.url)) as Watchlist;
const statePath = new URL("../../../watch/state.json", import.meta.url);
const state = readJson(statePath) as WatchState;

const fetcher: Fetcher = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "visa-rules-watch/0.1 (+https://github.com/visa-rules) change-detection" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, body: new Uint8Array(await res.arrayBuffer()) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

function flagFile(report: WatchReport, today: string) {
  const dir = new URL("../../../watch/flags/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const body = [
    `# Watch flag: ${report.id} — ${report.outcome}`,
    "",
    `- url: ${report.url}`,
    `- date: ${today}`,
    report.old_hash ? `- old: ${report.old_hash}` : "",
    report.new_hash ? `- new: ${report.new_hash}` : "",
    report.context ? `\n> …${report.context}…` : "",
    "",
    report.strategy === "pdf"
      ? "PDF changed — a human must read it; no value is extracted automatically."
      : report.outcome === "reminder-due"
        ? "Scheduled human re-verification is due."
        : "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
  ].filter(Boolean).join("\n");
  writeFileSync(new URL(`${report.id}-${today}.md`, dir), body + "\n");
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
  writeFileSync(statePath, JSON.stringify(nextState, null, 2) + "\n");
  log("info", "state committed", { entries: Object.keys(nextState.entries).length });
} else {
  log("info", "dry run — state untouched (use --commit to persist)");
}

log(unreachable ? "error" : "info", "watch complete", {
  total: reports.length,
  changed: reports.filter((r) => r.outcome === "changed").length,
  unreachable,
});
process.exit(unreachable > 0 ? 1 : 0);
