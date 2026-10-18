import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  runWatch, type BrowserReader, type Fetcher, type FetchResult, type WatchEntry, type WatchState, type Watchlist,
} from "./core.js";
import { openBrowserReader } from "./browser.js";
import { fetchSource } from "./fetch-source.js";
import {
  chooseEntries, parseJsonText, readRunArgs, sayRun, sayWhereItRead, settleState, type LogEvent,
} from "./run-says.js";

/**
 * The daily watch, from the command line.
 *
 * It reads the watchlist and the state, runs the watch with a fetcher and a
 * browser, prints what it read, writes the flag files and the state, prints
 * what became of them and exits. Everything it decides about what a run says is in `run-says.ts`;
 * this file only reads, runs, writes and exits.
 */

function print(event: LogEvent) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: event.level, msg: event.msg, ...event.fields });
  if (event.level === "error") console.error(line);
  else console.log(line);
}

const readJson = (url: URL) => parseJsonText(readFileSync(url, "utf8"));

const args = readRunArgs(process.argv);
const listed = readJson(new URL("../../../watch/watchlist.json", import.meta.url)) as Watchlist;
const statePath = new URL("../../../watch/state.json", import.meta.url);
const state = readJson(statePath) as WatchState;

const choice = chooseEntries(listed, args.only);
if (choice.kind === "no-such-entry") {
  print(choice.event);
  process.exit(choice.exitCode);
}
const watchlist = choice.watchlist;

const printWhereItRead = (entry: Pick<WatchEntry, "id" | "url">, result: FetchResult) => {
  const event = sayWhereItRead(entry, result);
  if (event) print(event);
};

/** Which entry an address belongs to, so a `read_at` names the entry a
 * curator knows it by rather than repeating the url twice. */
const entryAt = new Map(watchlist.entries.map((e) => [e.url, e.id]));

const readSourceOverHttp: Fetcher = async (url, redirects) => {
  const result = await fetchSource(url, redirects);
  printWhereItRead({ id: entryAt.get(url) ?? url, url }, result);
  return result;
};

/**
 * The browser half of the run: one Chrome, opened by the first entry that
 * needs one and closed on the way out, with what each page cost written down.
 *
 * The cost is logged rather than measured afterwards because it is the number
 * the browser tier is answerable for — seven rendered pages added to a daily
 * job — and a number nobody can read from the run's own log is a number
 * nobody checks (s34 point 6).
 */
const browser = openBrowserReader();
const openInBrowser: BrowserReader = async (entry, redirects) => {
  const started = Date.now();
  const result = await browser.read(entry, redirects);
  print({
    level: result.ok ? "info" : "error",
    msg: "watch:browser-read",
    fields: {
      id: entry.id, seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
      steps: entry.steps?.length ?? 0, ok: result.ok,
      // What naming ourselves to the source alone costs this page.
      ...browser.lastCost(),
    },
  });
  printWhereItRead(entry, result);
  return result;
};

const today = new Date().toISOString().slice(0, 10);
const { reports, nextState, verdict } = await runWatch(watchlist, state, readSourceOverHttp, today, openInBrowser);
await browser.close();

const settled = settleState({ args, previous: state, pass: nextState, fetched: watchlist, today });
const says = sayRun({ reports, verdict, today, state: settled.outcome });

for (const event of says.beforeWrites) print(event);
const flagsDir = new URL("../../../watch/flags/", import.meta.url);
if (says.flags.length) mkdirSync(flagsDir, { recursive: true });
for (const flag of says.flags) writeFileSync(new URL(flag.name, flagsDir), flag.body);
if (settled.text !== null) writeFileSync(statePath, settled.text);
for (const event of says.afterWrites) print(event);
process.exit(says.exitCode);
