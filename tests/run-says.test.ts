import { describe, expect, it } from "vitest";
import type { WatchEntry } from "../src/watch/core.js";
import { chooseEntries, parseJsonText, readRunArgs } from "../src/watch/run-says.js";

/**
 * #54 — what a finished watch run says, out of the CLI.
 *
 * Every case here was written against the format the CLI wrote before the
 * move, and passes on both sides of it: the flags, the log lines and the exit
 * code are the same bytes, now reached through a module a test can call.
 */

const entry = (id: string): WatchEntry =>
  ({ id, url: `https://example.org/${id}`, strategy: "html", kind: "value-source" });

describe("readRunArgs — what the command line asks", () => {
  it("reads the one entry and the commit", () => {
    expect(readRunArgs(["node", "cli-watch.js", "--only=nl-ind-blue-card", "--commit"]))
      .toEqual({ only: "nl-ind-blue-card", persist: "commit" });
  });

  it("is a dry run over every entry when given nothing", () => {
    expect(readRunArgs(["node", "cli-watch.js"])).toEqual({ only: undefined, persist: "dry-run" });
  });
});

describe("chooseEntries — the --only choice", () => {
  const watchlist = { entries: [entry("a"), entry("b"), entry("c")] };

  it("answers an unknown id with \"no such watch entry\" and exit 2", () => {
    expect(chooseEntries(watchlist, "nope")).toEqual({
      kind: "no-such-entry",
      event: { level: "error", msg: "no such watch entry", fields: { id: "nope" } },
      exitCode: 2,
    });
  });

  it("runs a known id's entry alone", () => {
    expect(chooseEntries(watchlist, "b")).toEqual({ kind: "run", watchlist: { entries: [entry("b")] } });
  });

  it("runs every entry when no id is given", () => {
    expect(chooseEntries(watchlist, undefined)).toEqual({ kind: "run", watchlist });
    expect(chooseEntries(watchlist, "")).toEqual({ kind: "run", watchlist });
  });
});

describe("parseJsonText — a hand-edited file", () => {
  it("parses a text with a leading BOM the same as one without", () => {
    const text = '{"entries":[{"id":"a"}]}';
    expect(parseJsonText("﻿" + text)).toEqual({ entries: [{ id: "a" }] });
    expect(parseJsonText(text)).toEqual({ entries: [{ id: "a" }] });
  });
});
