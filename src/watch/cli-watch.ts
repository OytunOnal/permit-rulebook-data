import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  mergeTargetedRun, runSummary, runWatch, STRATEGIES, unreadNotices,
  type BrowserReader, type Fetcher, type FetchResult, type WatchReport, type WatchState, type Watchlist,
} from "./core.js";
import { openBrowserReader } from "./browser.js";
import { fetchSource, printableAddress } from "./fetch-source.js";

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
    `- url: ${printableAddress(report.url)}`,
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

/**
 * Where the reading was actually taken, when that is not where it was asked
 * for — on either tier, by the same rule.
 *
 * Another ORIGIN is refused outright by both readers. This is the journey
 * inside one: a redirect the fetcher followed, a form that posts back to a
 * sub-path, a script that swaps the document. It is allowed, and a curator
 * should be able to see it without opening a browser — which is what the
 * comment on `from` in `core.ts` promises, and what only the browser tier
 * was doing until 2026-09-24.
 */
const sayWhereItRead = (entry: { id: string; url: string }, result: FetchResult) => {
  if (!result.ok || !result.from || result.from === entry.url) return;
  log("info", "watch:read_at", { id: entry.id, asked: printableAddress(entry.url), read_at: result.from });
};

/** Which entry an address belongs to, so a `read_at` names the entry a
 * curator knows it by rather than repeating the url twice. */
const entryAt = new Map(watchlist.entries.map((e) => [e.url, e.id]));

const readSourceOverHttp: Fetcher = async (url, redirects) => {
  const result = await fetchSource(url, redirects);
  sayWhereItRead({ id: entryAt.get(url) ?? url, url }, result);
  return result;
};

/**
 * The browser half of the run: one Chrome, opened by the first entry that
 * needs one and closed on the way out, with what each page cost written down.
 *
 * The cost is logged rather than measured afterwards because it is the number
 * the slice is answerable for — seven rendered pages inside a job that used to
 * take about two minutes — and a number nobody can read from the run's own log
 * is a number nobody checks (s34 point 6).
 */
const browser = openBrowserReader();
const openInBrowser: BrowserReader = async (entry, redirects) => {
  const started = Date.now();
  const result = await browser.read(entry, redirects);
  log(result.ok ? "info" : "error", "watch:browser-read", {
    id: entry.id, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    steps: entry.steps?.length ?? 0, ok: result.ok,
    // What naming ourselves to the source alone costs this page.
    ...browser.lastCost(),
  });
  sayWhereItRead(entry, result);
  return result;
};

const today = new Date().toISOString().slice(0, 10);
const { reports, nextState, verdict } = await runWatch(watchlist, state, readSourceOverHttp, today, openInBrowser);
await browser.close();

for (const r of reports) {
  const level = r.outcome === "unreachable" ? "error" : r.outcome === "unchanged" || r.outcome === "ok" ? "info" : "warn";
  log(level, `watch:${r.outcome}`, {
    id: r.id, url: printableAddress(r.url), old: r.old_hash, new: r.new_hash, error: r.error,
    // Which kind of failure it was, so a morning's log says why the run is
    // the colour it is without anybody reading the error back.
    failure: r.failure,
  });
  if (r.outcome === "changed" || r.outcome === "reminder-due") flagFile(r, today);
}

/**
 * What each unread source is, in one line each: a lapse warned about, an
 * outage and a refusal shouted about.
 *
 * The words and the loudness are the run's, decided in `core.ts` beside the
 * rule that colours the day — so the one place that knows a source has been
 * silent twice inside the week is the one place that says so, and this file
 * prints what it is handed. An outage's line carries the mornings it was
 * counted from, so a curator reads the days rather than the word alone.
 */
for (const notice of unreadNotices(verdict, today)) {
  log(notice.level, `watch:${notice.event}`, {
    id: notice.id, url: printableAddress(notice.url), days: notice.days, today: notice.today,
  });
}

if (commit) {
  // With `--only`, every other entry's snapshot is carried over untouched: a
  // targeted re-baseline must not quietly drop the twenty-nine it did not
  // fetch, and it must not stamp the day every source was last re-read. What
  // it may say something about is the one entry it did fetch. The rule lives
  // beside the code that writes a full run's state, where it can be read by a
  // test rather than by a grep over this file.
  const merged = only ? mergeTargetedRun(state, nextState, watchlist, today) : nextState;
  writeFileSync(statePath, JSON.stringify(merged, null, 2) + "\n");
  log("info", "state committed", {
    entries: Object.keys(merged.entries).length, only: only ?? null, last_run: merged.last_run,
  });
} else {
  log("info", "dry run — state untouched (use --commit to persist)");
}

/**
 * The run's last line, and the one signal the workflow reads.
 *
 * `lapsed` and `outages` sit beside `unreachable` so that a green day on
 * which a source still went unread is visible in the log and not only in
 * `watch/state.json`; `refused` is there so the three add up to
 * `unreachable` rather than leaving a reader to guess where the rest went.
 *
 * The exit code is the verdict's, not a count of failures: a source that has
 * been silent for one morning is a lapse and the run stays green, while an
 * outage — two mornings running — and anything the floor refused to request
 * are red the same day. `.github/workflows/watch.yml` keys on this step's
 * outcome and was not touched (s35 point 5).
 */
log(verdict.red ? "error" : "info", "watch complete", { ...runSummary(reports, verdict) });
process.exit(verdict.red ? 1 : 0);
