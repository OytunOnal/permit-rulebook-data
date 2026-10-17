import { describe, expect, it } from "vitest";
import type { WatchEntry } from "../src/watch/core.js";
import { chooseEntries, parseJsonText, readRunArgs, sayWhereItRead } from "../src/watch/run-says.js";

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

describe("sayWhereItRead — the read_at decision", () => {
  const asked = { id: "nl-ind-blue-card", url: "https://example.org/permit" };
  const body = new Uint8Array([1]);

  it("gives one event when an ok reading was taken at another address", () => {
    expect(sayWhereItRead(asked, { ok: true, body, from: "https://example.org/permit/answered" })).toEqual({
      level: "info",
      msg: "watch:read_at",
      fields: { id: "nl-ind-blue-card", asked: "https://example.org/permit", read_at: "https://example.org/permit/answered" },
    });
  });

  it("gives none when the reading was taken at its own address", () => {
    expect(sayWhereItRead(asked, { ok: true, body, from: "https://example.org/permit" })).toBeUndefined();
    expect(sayWhereItRead(asked, { ok: true, body })).toBeUndefined();
  });

  it("gives none when the reading failed", () => {
    expect(sayWhereItRead(asked, { ok: false, error: "HTTP 503", failure: "transient" })).toBeUndefined();
  });
});

describe("parseJsonText — a hand-edited file", () => {
  it("parses a text with a leading BOM the same as one without", () => {
    const text = '{"entries":[{"id":"a"}]}';
    expect(parseJsonText("﻿" + text)).toEqual({ entries: [{ id: "a" }] });
    expect(parseJsonText(text)).toEqual({ entries: [{ id: "a" }] });
  });
});
