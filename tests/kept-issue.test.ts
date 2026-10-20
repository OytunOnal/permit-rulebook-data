import { describe, expect, it } from "vitest";
import { actionOnKeptIssue, TRACKER_READ_LIMIT, type KeptIssue, type RunFinding } from "../src/watch/kept-issue.js";

/**
 * #117 — one table decides what a run does to the issue it keeps: what the run
 * found × the issue's state in the tracker → the action.
 */

const issue: KeptIssue = { title: "overdue flags", label: "watch" };
const red: RunFinding = { kind: "red", body: "Flags no person has walked." };
const green: RunFinding = { kind: "green", closing: "No overdue flag this morning." };
const unsaid: RunFinding = { kind: "unsaid" };

type Listed = { number: number; state: string; title: string };
const answer = (...issues: Listed[]) => JSON.stringify(issues);
const none = answer({ number: 3, state: "OPEN", title: "watch run failed" });
const open = answer({ number: 3, state: "OPEN", title: "watch run failed" }, { number: 40, state: "OPEN", title: "overdue flags" });
const closed = answer({ number: 40, state: "CLOSED", title: "overdue flags" });

describe("actionOnKeptIssue — a red run", () => {
  it("creates the issue when the tracker has none by its title", () => {
    expect(actionOnKeptIssue(issue, red, none)).toEqual({ kind: "create", title: "overdue flags", label: "watch", body: red.body });
  });

  it("comments on the open issue, and does not reopen it", () => {
    expect(actionOnKeptIssue(issue, red, open)).toEqual({ kind: "comment", number: 40, reopen: false, body: red.body });
  });

  it("reopens the closed issue and comments on it", () => {
    expect(actionOnKeptIssue(issue, red, closed)).toEqual({ kind: "comment", number: 40, reopen: true, body: red.body });
  });

  it("finds the issue by its exact title, never by a title that only contains it", () => {
    const nearMiss = answer(
      { number: 41, state: "OPEN", title: "overdue flags (old)" },
      { number: 42, state: "OPEN", title: "Overdue flags" },
    );
    expect(actionOnKeptIssue(issue, red, nearMiss)).toMatchObject({ kind: "create" });
    expect(actionOnKeptIssue(issue, red, answer({ number: 41, state: "OPEN", title: "overdue flags (old)" }, ...JSON.parse(closed))))
      .toEqual({ kind: "comment", number: 40, reopen: true, body: red.body });
  });
});

describe("actionOnKeptIssue — a green run", () => {
  it("closes the open issue with the run's closing line", () => {
    expect(actionOnKeptIssue(issue, green, open)).toEqual({ kind: "close", number: 40, comment: green.closing });
  });

  it.each([["there is no such issue", none], ["the issue is already closed", closed]])(
    "does nothing when %s",
    (_, listed) => { expect(actionOnKeptIssue(issue, green, listed)).toEqual({ kind: "nothing" }); },
  );
});

describe("actionOnKeptIssue — a run that says nothing about the issue", () => {
  it.each([["there is no such issue", none], ["the issue is open", open], ["the issue is closed", closed]])(
    "leaves it as it is when %s",
    (_, listed) => { expect(actionOnKeptIssue(issue, unsaid, listed)).toEqual({ kind: "nothing" }); },
  );
});

/**
 * A tracker the run did not read is the run's step failing, never a silent
 * "nothing": calling it "no such issue" would open a second one, and calling it
 * "closed" would leave an open one saying the run is still red.
 */
describe("actionOnKeptIssue — a tracker answer it cannot read", () => {
  const atTheLimit = answer(...Array.from({ length: TRACKER_READ_LIMIT }, (_, i) => ({ number: i + 100, state: "CLOSED", title: `flag ${i}` })));
  const unreadable: [string, string][] = [
    ["not JSON", "<html>rate limited</html>"],
    ["nothing at all", ""],
    ["not a list", JSON.stringify({ message: "Bad credentials" })],
    ["an issue without a number", JSON.stringify([{ state: "OPEN", title: "overdue flags" }])],
    ["an issue without a title", JSON.stringify([{ number: 40, state: "OPEN" }])],
    ["an issue in a state it does not know", answer({ number: 40, state: "MERGED", title: "overdue flags" })],
    ["as long as the read's limit, so the issue may be past it", atTheLimit],
  ];
  for (const [what, listed] of unreadable) {
    it.each([["red", red], ["green", green], ["unsaid", unsaid]] as const)(`is unread for a %s run when the answer is ${what}`, (_, finding) => {
      expect(actionOnKeptIssue(issue, finding, listed)).toMatchObject({ kind: "unread", reason: expect.any(String) });
    });
  }

  it("reads an answer one short of the limit", () => {
    const justUnder = answer(...Array.from({ length: TRACKER_READ_LIMIT - 1 }, (_, i) => ({ number: i + 100, state: "CLOSED", title: `flag ${i}` })));
    expect(actionOnKeptIssue(issue, red, justUnder)).toMatchObject({ kind: "create" });
  });
});

describe("actionOnKeptIssue — two issues under one title", () => {
  it("speaks on the open one, so a red run never reopens a second", () => {
    const both = answer({ number: 12, state: "CLOSED", title: "overdue flags" }, { number: 40, state: "OPEN", title: "overdue flags" });
    expect(actionOnKeptIssue(issue, red, both)).toEqual({ kind: "comment", number: 40, reopen: false, body: red.body });
    expect(actionOnKeptIssue(issue, green, both)).toEqual({ kind: "close", number: 40, comment: green.closing });
  });
});
