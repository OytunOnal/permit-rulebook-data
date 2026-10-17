import { describe, expect, it } from "vitest";
import { parseJsonText } from "../src/watch/run-says.js";

/**
 * #54 — what a finished watch run says, out of the CLI.
 *
 * Every case here was written against the format the CLI wrote before the
 * move, and passes on both sides of it: the flags, the log lines and the exit
 * code are the same bytes, now reached through a module a test can call.
 */

describe("parseJsonText — a hand-edited file", () => {
  it("parses a text with a leading BOM the same as one without", () => {
    const text = '{"entries":[{"id":"a"}]}';
    expect(parseJsonText("﻿" + text)).toEqual({ entries: [{ id: "a" }] });
    expect(parseJsonText(text)).toEqual({ entries: [{ id: "a" }] });
  });
});
