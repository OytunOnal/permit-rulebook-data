import { describe, expect, it } from "vitest";
import { overdueFlags, readClock, type OpenFlag } from "../src/watch/overdue.js";

/**
 * #62 — an overdue flag turns the morning red.
 *
 * The site promises that a flag is read within two days, and five flags sat
 * for up to ten (#12) because nothing counted. A flag raised on the 16th is
 * overdue on the 18th, whatever hour either run kept; why UTC days and not 48
 * hours is said in `src/watch/overdue.ts`.
 */

const flag = (number: number, createdAt: string, title = `Watch flag: entry-${number} — changed`): OpenFlag =>
  ({ number, title, createdAt });

describe("overdueFlags — the second morning after the day it was raised", () => {
  it("is overdue on the second day after, and not on the first, whatever the hour", () => {
    const late = flag(27, "2026-10-16T23:59:59Z");
    expect(overdueFlags([late], "2026-10-17")).toEqual([]);
    expect(overdueFlags([late], "2026-10-18")).toEqual([
      { number: 27, title: late.title, raised: "2026-10-16", days: 2 },
    ]);
  });

  it("is not overdue on the day it was raised", () => {
    expect(overdueFlags([flag(28, "2026-10-18T00:00:01Z")], "2026-10-18")).toEqual([]);
  });

  it("counts the days across a month's end and a year's", () => {
    expect(overdueFlags([flag(30, "2026-10-30T11:00:00Z")], "2026-11-01")).toEqual([
      expect.objectContaining({ number: 30, raised: "2026-10-30", days: 2 }),
    ]);
    expect(overdueFlags([flag(31, "2026-12-31T11:00:00Z")], "2027-01-01")).toEqual([]);
    expect(overdueFlags([flag(31, "2026-12-31T11:00:00Z")], "2027-01-02")).toEqual([
      expect.objectContaining({ number: 31, raised: "2026-12-31", days: 2 }),
    ]);
  });

  it("reads the day the flag was raised in UTC, not in the offset it was written with", () => {
    // 01:30 on the 17th in Amsterdam is 23:30 on the 16th in UTC.
    expect(overdueFlags([flag(32, "2026-10-17T01:30:00+02:00")], "2026-10-18")).toEqual([
      expect.objectContaining({ number: 32, raised: "2026-10-16", days: 2 }),
    ]);
  });

  it("names every overdue flag and its age, oldest first, and leaves the younger ones out", () => {
    const open = [
      flag(27, "2026-10-16T09:56:49Z"),
      flag(23, "2026-10-07T11:51:53Z"),
      flag(26, "2026-10-15T10:03:18Z"),
    ];
    expect(overdueFlags(open, "2026-10-16").map((f) => [f.number, f.days])).toEqual([[23, 9]]);
    expect(overdueFlags(open, "2026-10-17").map((f) => [f.number, f.days])).toEqual([[23, 10], [26, 2]]);
    expect(overdueFlags(open, "2026-10-18").map((f) => [f.number, f.days])).toEqual([[23, 11], [26, 3], [27, 2]]);
  });

  it("finds nothing overdue when nothing is open", () => {
    expect(overdueFlags([], "2026-10-18")).toEqual([]);
  });
});

/**
 * What the morning's run is told, from what the tracker listed: clear,
 * overdue, or unread. A list the clock cannot make sense of is a tracker it did
 * not read, and calling it clear would be the silent skip.
 */
describe("readClock — what the morning's run is told", () => {
  const asJson = (flags: unknown) => JSON.stringify(flags);

  it("is clear when every open flag is younger than two days", () => {
    const reading = readClock(asJson([flag(27, "2026-10-16T09:56:49Z")]), "2026-10-17");
    expect(reading).toMatchObject({ kind: "clear", open: 1 });
  });

  it("is clear when no flag is open", () => {
    expect(readClock("[]", "2026-10-18")).toMatchObject({ kind: "clear", open: 0 });
  });

  it("is overdue when a flag is, and names each overdue flag, the day it was raised and its age", () => {
    const reading = readClock(asJson([
      flag(27, "2026-10-16T09:56:49Z", "Watch flag: nl-ind-blue-card — changed"),
      flag(23, "2026-10-07T11:51:53Z", "Watch flag: nl-ind-orientation-year — changed"),
      flag(29, "2026-10-18T10:00:00Z"),
    ]), "2026-10-18");
    expect(reading.kind).toBe("overdue");
    if (reading.kind !== "overdue") return;
    expect(reading.overdue.map((f) => f.number)).toEqual([23, 27]);
    // The body's contract is #62's own: the issue names "each overdue flag with
    // its link, the day it was raised and its age in days". One line per flag,
    // and the younger one is not named at all.
    const lineOf = (n: number) => reading.body.split("\n").filter((l) => l.includes(`#${n} `));
    expect(lineOf(23)).toEqual([expect.stringMatching(/2026-10-07.*\b11 days\b/)]);
    expect(lineOf(27)).toEqual([expect.stringMatching(/2026-10-16.*\b2 days\b/)]);
    expect(lineOf(29)).toEqual([]);
  });

  it.each([
    ["not JSON", "<html>rate limited</html>"],
    ["nothing at all", ""],
    ["not a list", asJson({ message: "Bad credentials" })],
    ["a flag without a number", asJson([{ title: "Watch flag", createdAt: "2026-10-16T09:56:49Z" }])],
    ["a flag without a title", asJson([{ number: 27, createdAt: "2026-10-16T09:56:49Z" }])],
    ["a flag whose day cannot be read", asJson([flag(27, "yesterday")])],
  ])("is unread when the tracker's answer is %s", (_, text) => {
    expect(readClock(text, "2026-10-18")).toMatchObject({ kind: "unread" });
  });
});
