/**
 * What a finished watch run says (#54): its flags, its log lines and its exit
 * code, returned as data, and the choices the run makes on the way there.
 *
 * `cli-watch.ts` reads the files, runs the watch, writes what this module
 * returns and exits. Every branch that decides what a run says is here, where
 * a test can call it; the CLI holds only I/O.
 */
import { mergeTargetedRun, type FetchResult, type WatchState, type Watchlist } from "./core.js";
import { printableAddress } from "./fetch-source.js";

export type LogLevel = "info" | "warn" | "error";

/** One log line before it is printed: the CLI stamps `ts` on it. */
export interface LogEvent {
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

/** What the command line asks of a run. */
export interface RunArgs {
  /** `--only=<id>`: the one entry to run, the rule at `chooseEntries`. */
  only?: string;
  /** `--commit` writes the state; without it the run is a dry run. */
  persist: "commit" | "dry-run";
}

export function readRunArgs(argv: readonly string[]): RunArgs {
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  return {
    only: onlyArg?.slice("--only=".length),
    persist: argv.includes("--commit") ? "commit" : "dry-run",
  };
}

/** The entries a run reads, or the answer to an id the watchlist does not hold. */
export type EntryChoice =
  | { kind: "run"; watchlist: Watchlist }
  | { kind: "no-such-entry"; event: LogEvent; exitCode: 2 };

/**
 * `--only=<id>` runs one entry and leaves every other snapshot untouched.
 *
 * A curator who moves a slice marker on purpose has to re-baseline that entry
 * and only that entry: running all thirty would rewrite thirty snapshots and
 * bury the one deliberate change among them. The daily run passes no filter
 * and is unaffected.
 */
export function chooseEntries(watchlist: Watchlist, only: string | undefined): EntryChoice {
  if (!only) return { kind: "run", watchlist };
  const wanted = watchlist.entries.filter((e) => e.id === only);
  if (!wanted.length) {
    return { kind: "no-such-entry", event: { level: "error", msg: "no such watch entry", fields: { id: only } }, exitCode: 2 };
  }
  return { kind: "run", watchlist: { ...watchlist, entries: wanted } };
}

/** What became of the state at the end of a run. */
export type StateOutcome =
  | { kind: "committed"; entries: number; only?: string; last_run?: string }
  | { kind: "dry-run" };

/** A finished pass, and what the command line asked to do with its state. */
export interface PassToSettle {
  args: RunArgs;
  previous: WatchState;
  pass: WatchState;
  /** The entries the pass read: the whole watchlist, or the one `--only` named. */
  fetched: Watchlist;
  today: string;
}

/** What becomes of the state: the outcome the run reports, and the file's text when it is written. */
export interface SettledState {
  outcome: StateOutcome;
  text: string | null;
}

export function settleState(settle: PassToSettle): SettledState {
  if (settle.args.persist === "dry-run") return { outcome: { kind: "dry-run" }, text: null };
  // With `--only`, every other entry's snapshot is carried over untouched: a
  // targeted re-baseline must not quietly drop the twenty-nine it did not
  // fetch, and it must not stamp the day every source was last re-read. What
  // it may say something about is the one entry it did fetch. The rule is
  // `mergeTargetedRun`, beside the code that writes a full run's state.
  const merged = settle.args.only
    ? mergeTargetedRun(settle.previous, settle.pass, settle.fetched, settle.today)
    : settle.pass;
  return {
    outcome: { kind: "committed", entries: Object.keys(merged.entries).length, only: settle.args.only, last_run: merged.last_run },
    text: JSON.stringify(merged, null, 2) + "\n",
  };
}

/**
 * Where the reading was actually taken, when that is not where it was asked
 * for — on either tier, by the same rule.
 *
 * Another ORIGIN is refused outright by both readers. This is the journey
 * inside one: a redirect the fetcher followed, a form that posts back to a
 * sub-path, a script that swaps the document. It is allowed, and a curator
 * should be able to see it without opening a browser — which is what the
 * comment on `from` in `core.ts` promises.
 */
export function sayWhereItRead(entry: { id: string; url: string }, result: FetchResult): LogEvent | undefined {
  const readAt = addressReadElsewhere(entry, result);
  if (!readAt) return undefined;
  return { level: "info", msg: "watch:read_at", fields: { id: entry.id, asked: printableAddress(entry.url), read_at: readAt } };
}

/** The address an ok reading was taken at, when it is not the one asked for. */
function addressReadElsewhere(entry: { url: string }, result: FetchResult): string | undefined {
  if (!result.ok || result.from === entry.url) return undefined;
  return result.from || undefined;
}

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ""));
}
