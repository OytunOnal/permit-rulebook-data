import { describe, expect, it } from "vitest";
import { sayBrowserRead } from "../src/watch/run-says.js";

/**
 * The `watch:browser-read` line each browser read logs, reached through the
 * module the watch's CLI prints it from.
 */
describe("sayBrowserRead — the line a browser read logs", () => {
  const entry = { id: "de-bmi-chancenkarte", steps: [{ step: "expand" as const }] };
  const cost = { paused: 2, pausedMs: 40 };

  it("logs a page read as info: the entry, its seconds to a tenth, its steps, ok and the interception's cost", () => {
    const read = { entry, result: { ok: true as const, body: new Uint8Array([1]) }, milliseconds: 48_840, cost };
    expect(sayBrowserRead(read)).toEqual({
      level: "info",
      msg: "watch:browser-read",
      fields: { id: "de-bmi-chancenkarte", seconds: 48.8, steps: 1, ok: true, paused: 2, pausedMs: 40 },
    });
  });

  /**
   * A try that ends under its budget with nothing read says why, on its own
   * line: a try its retry recovers prints no other (ruling 10 on
   * OytunOnal/permit-rulebook#341).
   */
  it("logs a failed read as an error carrying the reader's error and failure", () => {
    const result = { ok: false as const, error: "the page closed its connection", failure: "transient" as const };
    expect(sayBrowserRead({ entry, result, milliseconds: 31_400, cost })).toEqual({
      level: "error",
      msg: "watch:browser-read",
      fields: {
        id: "de-bmi-chancenkarte", seconds: 31.4, steps: 1, ok: false,
        error: "the page closed its connection", failure: "transient", paused: 2, pausedMs: 40,
      },
    });
  });
});
