import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mergeTargetedRun, runWatch, STRATEGIES, type BrowserReader, type Fetcher, type WatchReport, type WatchState, type Watchlist } from "./core.js";
import { openBrowserReader } from "./browser.js";

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
      // Who is asking, and where to find whoever sent it — but the address
      // travels beside the name rather than inside it.
      //
      // The name used to carry the repository in parentheses, the way a
      // crawler conventionally does, and `inclusion.gob.es` answered 403 to
      // exactly that: the watch failed every day from 2026-09-11 to 15 and
      // Spain's salary threshold went unread for eight days while the site
      // still said "re-read daily". Measured on 2026-09-15, same host, same
      // minute: the full string 403, the string without its trailing purpose
      // word 403, `Mozilla/5.0 (compatible; …; +https://…)` 403 — and
      // `permit-rulebook-watch/0.1` **200**, 299,066 bytes. The filter objects
      // to a URL inside the User-Agent, not to a reader that names itself. So
      // the name stays, unique enough to find this repository by, and the link
      // moves to a header of its own, which the same host serves happily
      // (data #18).
      headers: {
        "user-agent": "permit-rulebook-watch/0.1",
        "x-source-contact": "https://github.com/OytunOnal/permit-rulebook-data",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
    const body = new Uint8Array(await res.arrayBuffer());
    // An empty body is not a page, whatever the status line says. EUR-Lex
    // answers this fetcher with `202 Accepted` and nothing at all — a bot
    // challenge — and `res.ok` is true for it, so the pass would have recorded
    // a blank snapshot as a successful read and reported "unchanged" ever
    // after (measured 2026-09-10, s8).
    if (body.byteLength === 0) return { ok: false, status: res.status, error: `HTTP ${res.status} with an empty body` };
    return { ok: true, body };
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
const openInBrowser: BrowserReader = async (entry) => {
  const started = Date.now();
  const result = await browser.read(entry);
  log(result.ok ? "info" : "error", "watch:browser-read", {
    id: entry.id, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    steps: entry.steps?.length ?? 0, ok: result.ok,
  });
  return result;
};

const today = new Date().toISOString().slice(0, 10);
const { reports, nextState } = await runWatch(watchlist, state, fetcher, today, openInBrowser);
await browser.close();

let unreachable = 0;
for (const r of reports) {
  const level = r.outcome === "unreachable" ? "error" : r.outcome === "unchanged" || r.outcome === "ok" ? "info" : "warn";
  log(level, `watch:${r.outcome}`, { id: r.id, url: r.url, old: r.old_hash, new: r.new_hash, error: r.error });
  if (r.outcome === "unreachable") unreachable++;
  if (r.outcome === "changed" || r.outcome === "reminder-due") flagFile(r, today);
}

if (commit) {
  // With `--only`, every other entry's snapshot is carried over untouched: a
  // targeted re-baseline must not quietly drop the twenty-nine it did not
  // fetch, and it must not stamp the day every source was last re-read. What
  // it may say something about is the one entry it did fetch. The rule lives
  // beside the code that writes a full run's state, where it can be read by a
  // test rather than by a grep over this file.
  const merged = only ? mergeTargetedRun(state, nextState, watchlist) : nextState;
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
