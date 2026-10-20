import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepIssue } from "../src/watch/keep-issue.js";
import type { GhRunner } from "../src/watch/gh.js";

/**
 * #117, seam 5 as the ruling of 2026-10-20 builds it: the kept-issue CLI as a
 * function handed a runner, so each case records exactly what reaches `gh`.
 */

const temps: string[] = [];
const tempFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), "kept-issue-"));
  temps.push(folder);
  return folder;
};
afterEach(() => { for (const folder of temps.splice(0)) rmSync(folder, { recursive: true, force: true }); });

/** A tracker that answers the read with `listed`, and records every argument list. */
function trackerAnswering(listed: string, failing?: string) {
  const calls: string[][] = [];
  const runGh: GhRunner = async (args) => {
    calls.push([...args]);
    if (failing && args[0] === "issue" && args[1] === failing) throw new Error(`gh issue ${failing} failed`);
    return args[1] === "list" ? listed : "";
  };
  return { calls, runGh, writes: () => calls.filter((c) => c[1] !== "list") };
}

const keptAs = (title = "overdue flags") => [
  "--title", title, "--label", "watch",
  "--label-color", "b60205", "--label-description", "The daily source watch itself",
];
const red = ["--finding", "red", "--body", "Flags no person has walked."];
const green = ["--finding", "green", "--closing", "No overdue flag this morning."];
const listedOf = (...issues: { number: number; state: string; title: string }[]) => JSON.stringify(issues);
const openIssue = listedOf({ number: 40, state: "OPEN", title: "overdue flags" });
const closedIssue = listedOf({ number: 40, state: "CLOSED", title: "overdue flags" });

describe("the kept-issue CLI — what reaches gh for each action", () => {
  it("reads the tracker once, by the issue's label, open or closed, bounded", async () => {
    const tracker = trackerAnswering("[]");
    await keepIssue([...keptAs(), ...green], tracker.runGh);
    expect(tracker.calls[0]).toEqual(expect.arrayContaining(["issue", "list", "--label", "watch", "--state", "all", "--limit"]));
    expect(tracker.calls.filter((c) => c[1] === "list")).toHaveLength(1);
  });

  it("creates the label, then the issue, on a red run with no such issue", async () => {
    const tracker = trackerAnswering("[]");
    const run = await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([
      ["label", "create", "watch", "--color", "b60205", "--description", "The daily source watch itself", "--force"],
      ["issue", "create", "--title", "overdue flags", "--label", "watch", "--body", "Flags no person has walked."],
    ]);
    expect(run.exitCode).toBe(0);
  });

  it("comments on the open issue on a red run", async () => {
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "comment", "40", "--body", "Flags no person has walked."]]);
    expect(run.exitCode).toBe(0);
  });

  it("reopens the closed issue, then comments, on a red run", async () => {
    const tracker = trackerAnswering(closedIssue);
    await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "reopen", "40"], ["issue", "comment", "40", "--body", "Flags no person has walked."]]);
  });

  it("closes the open issue on a green run", async () => {
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue([...keptAs(), ...green], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "close", "40", "--comment", "No overdue flag this morning."]]);
    expect(run.exitCode).toBe(0);
  });

  it("writes nothing when there is nothing to do", async () => {
    const tracker = trackerAnswering(closedIssue);
    const run = await keepIssue([...keptAs(), ...green], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(0);
    const unsaid = trackerAnswering(openIssue);
    expect((await keepIssue([...keptAs(), "--finding", "unsaid"], unsaid.runGh)).exitCode).toBe(0);
    expect(unsaid.writes()).toEqual([]);
  });

  it("fails, writing nothing, when the tracker's answer cannot be read", async () => {
    const tracker = trackerAnswering("<html>rate limited</html>");
    const run = await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error" }));
  });

  it("fails, writing nothing, when the tracker cannot be asked", async () => {
    const tracker = trackerAnswering("[]", "list");
    const run = await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it("fails, and stops, when a write does not go through", async () => {
    const tracker = trackerAnswering(closedIssue, "reopen");
    const run = await keepIssue([...keptAs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "reopen", "40"]]);
    expect(run.exitCode).toBe(1);
  });

  it("hands gh a hostile title and body intact, each one argument", async () => {
    const title = "flags $(touch pwned) `id` \"quoted\" 'single'; rm -rf ~";
    const body = "line one\n$(touch pwned)\n`id` \"q\" 'q' && echo done";
    const tracker = trackerAnswering("[]");
    await keepIssue([...keptAs(title), "--finding", "red", "--body", body], tracker.runGh);
    expect(tracker.writes()[1]).toEqual(["issue", "create", "--title", title, "--label", "watch", "--body", body]);
  });

  it("takes the finding from a file, as the clock writes it", async () => {
    const file = join(tempFolder(), "finding.json");
    writeFileSync(file, JSON.stringify({ kind: "red", body: "From the clock.\n\nRun: https://example.test/runs/1\n" }));
    const tracker = trackerAnswering(openIssue);
    await keepIssue([...keptAs(), "--finding-file", file], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "comment", "40", "--body", "From the clock.\n\nRun: https://example.test/runs/1\n"]]);
  });

  it.each([
    ["no title", ["--label", "watch", "--label-color", "b60205", "--label-description", "D", ...red]],
    ["no finding", keptAs()],
    ["a finding it does not know", [...keptAs(), "--finding", "amber"]],
    ["a red finding with no body", [...keptAs(), "--finding", "red"]],
    ["an argument it does not know", [...keptAs(), ...red, "--repo", "someone/else"]],
  ])("refuses to run, asking gh nothing, given %s", async (_, argv) => {
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue(argv, tracker.runGh);
    expect(tracker.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it("refuses a finding file it cannot read as a finding", async () => {
    const file = join(tempFolder(), "finding.json");
    writeFileSync(file, JSON.stringify({ kind: "red" }));
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue([...keptAs(), "--finding-file", file], tracker.runGh);
    expect(tracker.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });
});
