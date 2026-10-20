import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GhRunner } from "../src/watch/gh.js";
import { readClockOnFlags } from "../src/watch/overdue-command.js";
import { tempFoldersRemovedAfterEach } from "./stub-gh.js";

/**
 * The clock's CLI as a function handed a runner (#117, seam 5's first part):
 * what it asks `gh`, the finding it writes for `overdue flags`, and the
 * `reading=` it gives the step.
 */

const tempFolder = tempFoldersRemovedAfterEach("overdue-clock-");
const TODAY = "2026-10-18";
const RUN = "https://github.com/OytunOnal/permit-rulebook-data/actions/runs/123";

/** A tracker that answers the read with `listed` (or fails it), and records every argument list. */
function trackerAnswering(listed: string | Error) {
  const calls: string[][] = [];
  const runGh: GhRunner = async (args) => {
    calls.push([...args]);
    if (listed instanceof Error) throw listed;
    return listed;
  };
  return { calls, runGh };
}

/** The clock's arguments, its two outputs in a folder of the case's own. */
function clockArgs() {
  const folder = tempFolder();
  const findingFile = join(folder, "overdue-finding.json");
  const stepOutput = join(folder, "github-output");
  const argv = ["--finding-file", findingFile, "--run-url", RUN, "--step-output", stepOutput, "--label", FLAG_LABEL];
  return { argv, findingFile, stepOutput };
}

/** Not the label the workflow passes, so a label written into the CLI cannot pass for it. */
const FLAG_LABEL = "a-label-for-this-test";

const flag = (number: number, createdAt: string) => ({ number, title: `Watch flag: entry-${number} — changed`, createdAt });

describe("the clock's CLI — what it hands the run", () => {
  it("reads the tracker once: the open flags under the label it is given, bounded", async () => {
    const tracker = trackerAnswering("[]");
    await readClockOnFlags(clockArgs().argv, tracker.runGh, TODAY);
    expect(tracker.calls).toEqual([
      ["issue", "list", "--label", FLAG_LABEL, "--state", "open", "--json", "number,title,createdAt", "--limit", "1000"],
    ]);
  });

  it("gives the step reading=clear, and a green finding linking the run, on a morning nothing is overdue", async () => {
    const { argv, findingFile, stepOutput } = clockArgs();
    const run = await readClockOnFlags(argv, trackerAnswering(JSON.stringify([flag(30, "2026-10-17T09:00:00Z")])).runGh, TODAY);
    expect(readFileSync(stepOutput, "utf8")).toBe("reading=clear\n");
    expect(JSON.parse(readFileSync(findingFile, "utf8"))).toEqual({ kind: "green", closing: expect.stringContaining(RUN) });
    expect(run.exitCode).toBe(0);
  });

  it("gives the step reading=overdue, and a red finding, and still passes, on a morning a flag is overdue", async () => {
    const { argv, findingFile, stepOutput } = clockArgs();
    const run = await readClockOnFlags(argv, trackerAnswering(JSON.stringify([flag(23, "2026-10-07T11:51:53Z")])).runGh, TODAY);
    expect(readFileSync(stepOutput, "utf8")).toBe("reading=overdue\n");
    const finding = JSON.parse(readFileSync(findingFile, "utf8"));
    expect(finding.kind).toBe("red");
    expect(finding.body).toContain("#23");
    expect(finding.body).toContain(RUN);
    // An overdue flag reddens the run at the workflow's last step, not here.
    expect(run.exitCode).toBe(0);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error", msg: "overdue clock" }));
  });

  /**
   * The body reaches `gh` as one argument, and Linux refuses one past 128 KiB:
   * so it names a bounded number of flags and says how many more there are.
   */
  it("names a bounded number of overdue flags in the finding, and says how many more there are", async () => {
    const { argv, findingFile } = clockArgs();
    const overdue = Array.from({ length: 120 }, (_, i) => flag(1000 + i, "2026-10-07T11:51:53Z"));
    await readClockOnFlags(argv, trackerAnswering(JSON.stringify(overdue)).runGh, TODAY);
    const body: string = JSON.parse(readFileSync(findingFile, "utf8")).body;
    const named = body.split("\n").filter((line) => line.startsWith("- #"));
    expect(named.length).toBeGreaterThan(0);
    expect(named.length, "every overdue flag is named").toBeLessThan(overdue.length);
    expect(body, "the body does not say how many more there are").toMatch(new RegExp(`\\b${overdue.length - named.length}\\b`));
  });

  it("gives the step reading=unread, says nothing to the issue, and fails, when the tracker cannot be asked", async () => {
    const { argv, findingFile, stepOutput } = clockArgs();
    const run = await readClockOnFlags(argv, trackerAnswering(new Error("gh: HTTP 502")).runGh, TODAY);
    expect(readFileSync(stepOutput, "utf8")).toBe("reading=unread\n");
    expect(JSON.parse(readFileSync(findingFile, "utf8"))).toEqual({ kind: "unsaid" });
    expect(run.exitCode).toBe(1);
  });

  it.each([
    ["no run url", (argv: string[]) => argv.filter((_, i) => i !== 2 && i !== 3)],
    ["an argument it does not know", (argv: string[]) => [...argv, "--repo", "someone/else"]],
    ["an argument with an empty value", (argv: string[]) => [...argv.slice(0, -1), ""]],
  ])("refuses to run, asking gh nothing and writing nothing, given %s", async (_, argsGiven) => {
    const { argv, findingFile, stepOutput } = clockArgs();
    const tracker = trackerAnswering("[]");
    const run = await readClockOnFlags(argsGiven(argv), tracker.runGh, TODAY);
    expect(tracker.calls).toEqual([]);
    expect(existsSync(findingFile) || existsSync(stepOutput), "it wrote an output").toBe(false);
    expect(run.exitCode).toBe(1);
  });
});
