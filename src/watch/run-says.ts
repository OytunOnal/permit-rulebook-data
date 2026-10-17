/**
 * What a finished watch run says (#54): its flags, its log lines and its exit
 * code, returned as data, and the choices the run makes on the way there.
 *
 * `cli-watch.ts` reads the files, runs the watch, writes what this module
 * returns and exits. Every branch that decides what a run says is here, where
 * a test can call it; the CLI holds only I/O.
 */
import type { Watchlist } from "./core.js";

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

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ""));
}
