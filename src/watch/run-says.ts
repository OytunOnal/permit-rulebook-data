/**
 * What a finished watch run says (#54): its flags, its log lines and its exit
 * code, returned as data, and the choices the run makes on the way there.
 *
 * `cli-watch.ts` reads the files, runs the watch, writes what this module
 * returns and exits. Every branch that decides what a run says is here, where
 * a test can call it; the CLI holds only I/O.
 */

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ""));
}
