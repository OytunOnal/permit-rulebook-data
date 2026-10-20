import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runWatch, type BrowserReader, type Fetcher, type FetchResult, type WatchEntry, type WatchState, type Watchlist,
} from "./core.js";
import { openBrowserReader } from "./browser.js";
import { fetchSource } from "./fetch-source.js";
import {
  chooseEntries, parseJsonText, readRunArgs, sayRun, sayWhereItRead, settleState,
} from "./run-says.js";
import { readBoundedFile } from "./cli-shared.js";
import { FLAG_FILE_LIMIT_BYTES, newFlagsListOf } from "./flag-issues.js";
import { print } from "./print.js";

/**
 * The daily watch, from the command line.
 *
 * It reads the watchlist and the state, runs the watch with a fetcher and a
 * browser, prints what it read, writes the flag files, the state and (given
 * `--new-flags=<path>`) the list of this run's new flags for the step that
 * files their issues, prints what became of them and exits. Everything it decides about what a run says is in `run-says.ts`;
 * this file only reads, runs, writes and exits.
 */

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

const flagsDir = new URL("../../../watch/flags/", import.meta.url);
const flagTextOnDisk = (name: string): string | undefined => {
  const read = readBoundedFile(fileURLToPath(new URL(name, flagsDir)), FLAG_FILE_LIMIT_BYTES);
  if (read.kind === "read") return read.text;
  // No such file: this run creates the flag. A link, a folder or a file too
  // large to be a flag is an error to see.
  if (read.missing) return undefined;
  throw new Error(read.reason);
};

const settled = settleState({ args, previous: state, pass: nextState, fetched: watchlist, today });
const says = sayRun({ reports, verdict, today, state: settled.outcome, flagTextOnDisk });

for (const event of says.beforeWrites) print(event);
if (says.flags.length) mkdirSync(flagsDir, { recursive: true });
for (const flag of says.flags) writeFileSync(new URL(flag.name, flagsDir), flag.body);
if (settled.text !== null) writeFileSync(statePath, settled.text);
// After the state, so a list that cannot be written costs the run its flag
// issues (the filing step then fails on the missing list), never its state.
if (args.newFlagsList) writeFileSync(args.newFlagsList, newFlagsListOf(says.flags));
for (const event of says.afterWrites) print(event);
process.exit(says.exitCode);
