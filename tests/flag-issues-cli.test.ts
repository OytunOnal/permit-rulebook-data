import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileFlagIssues, NEW_FLAGS_LIMIT, newFlagsListOf } from "../src/watch/flag-issues.js";
import type { GhRunner } from "../src/watch/gh.js";
import type { FlagDocument } from "../src/watch/run-says.js";

/**
 * #117 decision 14, seam 5 as the ruling of 2026-10-20 builds it: the
 * flag-filing CLI as a function handed a runner, so each case records exactly
 * what reaches `gh`. The watch writes this run's flags and the list of them;
 * after the push, this CLI files one `source-change` issue per flag on it.
 */

const temps: string[] = [];
const tempFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), "flag-issues-"));
  temps.push(folder);
  return folder;
};
afterEach(() => { for (const folder of temps.splice(0)) rmSync(folder, { recursive: true, force: true }); });

/** A tracker that records every argument list, failing the issue create whose title is `failingTitle`. */
function tracker(failingTitle?: string) {
  const calls: string[][] = [];
  const runGh: GhRunner = async (args) => {
    calls.push([...args]);
    if (failingTitle && args[1] === "create" && args.includes(failingTitle)) throw new Error("gh issue create failed");
    return "";
  };
  return { calls, runGh, issues: () => calls.filter((c) => c[0] === "issue") };
}

const LABEL = ["--label", "source-change", "--label-color", "e4a11b", "--label-description", "A watched official source changed"];
const LABEL_CREATE = ["label", "create", "source-change", "--color", "e4a11b", "--description", "A watched official source changed", "--force"];

/**
 * The flags written into a flags folder, and the list of them, as the watch's
 * CLI leaves them. The folder sits inside the case's own, beside a file that
 * is not a flag, so a list can point out of it.
 */
function handedOver(flags: FlagDocument[], list = newFlagsListOf(flags)): string[] {
  const root = tempFolder();
  const flagsDir = join(root, "flags");
  mkdirSync(flagsDir);
  for (const flag of flags) writeFileSync(join(flagsDir, flag.name), flag.body);
  writeFileSync(join(root, "outside.md"), "# Not a flag\n");
  const listFile = join(tempFolder(), "new-flags.json");
  writeFileSync(listFile, list);
  return ["--list", listFile, "--flags-dir", flagsDir, ...LABEL];
}

const change: FlagDocument = {
  name: "nl-ind-blue-card-2026-10-20.md",
  title: "Watch flag: nl-ind-blue-card — changed",
  body: "# Watch flag: nl-ind-blue-card — changed\n- date: 2026-10-20\n\nUpdate the dataset value.\n",
};
const reminder: FlagDocument = {
  name: "gesetze-official-recheck-reminder.md",
  title: "Watch flag: gesetze-official-recheck — reminder-due",
  body: "# Watch flag: gesetze-official-recheck — reminder-due\n\nRe-read the annex by hand.\n",
};

const issueCreate = (flag: FlagDocument) =>
  ["issue", "create", "--title", flag.title, "--label", "source-change", "--body", flag.body];

describe("the flag-filing CLI — what reaches gh", () => {
  it("files one issue per listed flag, with its title and its file's body, the label first", async () => {
    const gh = tracker();
    const run = await fileFlagIssues(handedOver([change, reminder]), gh.runGh);
    expect(gh.calls).toEqual([LABEL_CREATE, issueCreate(change), LABEL_CREATE, issueCreate(reminder)]);
    expect(run.exitCode).toBe(0);
  });

  it("hands gh a hostile title intact, as one argument", async () => {
    const hostile = { ...change, title: "Watch flag: $(touch pwned) `id` \"quoted\" 'single'; rm -rf ~ — changed" };
    const gh = tracker();
    await fileFlagIssues(handedOver([hostile]), gh.runGh);
    expect(gh.issues()).toEqual([issueCreate(hostile)]);
  });

  it("files nothing, and passes, on a morning with no new flag", async () => {
    const gh = tracker();
    const run = await fileFlagIssues(handedOver([]), gh.runGh);
    expect(gh.calls).toEqual([]);
    expect(run.exitCode).toBe(0);
  });

  /** Every loop over outside input is bounded (#117 decision 12): a list over the bound is refused whole, never cut. */
  it("refuses a list over its bound, filing none of it", async () => {
    const many = Array.from({ length: NEW_FLAGS_LIMIT + 1 }, (_, i) => ({ ...change, name: `entry-${i}-2026-10-20.md`, title: `Watch flag: entry-${i} — changed` }));
    const gh = tracker();
    const run = await fileFlagIssues(handedOver(many), gh.runGh);
    expect(gh.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error" }));
  });

  it.each([
    ["not JSON", "file,title\n"],
    ["not a list", JSON.stringify({ file: change.name, title: change.title })],
    ["a file outside the flags folder", JSON.stringify([{ file: "../outside.md", title: change.title }])],
    ["a file in a folder below it", JSON.stringify([{ file: "deeper/x.md", title: change.title }])],
    ["a file that is not a flag's markdown", JSON.stringify([{ file: "state.json", title: change.title }])],
    ["a flag with no title", JSON.stringify([{ file: change.name, title: "" }])],
  ])("refuses a list holding %s, filing none of it", async (_, list) => {
    const gh = tracker();
    const run = await fileFlagIssues(handedOver([change], list), gh.runGh);
    expect(gh.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it.each([
    ["is missing", (path: string) => rmSync(path)],
    ["is a folder", (path: string) => { rmSync(path); mkdirSync(path); }],
    ["is larger than an issue's body can be", (path: string) => writeFileSync(path, "x".repeat(65_537))],
  ])("files every other flag, and fails, when one flag's file %s", async (_, spoil) => {
    const args = handedOver([change, reminder]);
    spoil(join(args[3]!, change.name));
    const gh = tracker();
    const run = await fileFlagIssues(args, gh.runGh);
    expect(gh.issues()).toEqual([issueCreate(reminder)]);
    expect(run.exitCode).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error", fields: expect.objectContaining({ file: change.name }) }));
  });

  it("files every other flag, and fails, when gh refuses one", async () => {
    const gh = tracker(change.title);
    const run = await fileFlagIssues(handedOver([change, reminder]), gh.runGh);
    expect(gh.issues()).toEqual([issueCreate(change), issueCreate(reminder)]);
    expect(run.exitCode).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error", fields: expect.objectContaining({ file: change.name }) }));
  });

  it.each([
    ["no list", (args: string[]) => args.slice(2)],
    ["no label colour", (args: string[]) => args.slice(0, 6)],
    ["an argument it does not know", (args: string[]) => [...args, "--repo", "someone/else"]],
    ["an argument with no value", (args: string[]) => [...args, "--list"]],
  ])("refuses to run, asking gh nothing, given %s", async (_, argsGiven) => {
    const gh = tracker();
    const run = await fileFlagIssues(argsGiven(handedOver([reminder])), gh.runGh);
    expect(gh.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it("files a list at its bound whole", async () => {
    const most = Array.from({ length: NEW_FLAGS_LIMIT }, (_, i) => ({ ...change, name: `entry-${i}-2026-10-20.md`, title: `Watch flag: entry-${i} — changed` }));
    const gh = tracker();
    const run = await fileFlagIssues(handedOver(most), gh.runGh);
    expect(gh.issues()).toHaveLength(NEW_FLAGS_LIMIT);
    expect(run.exitCode).toBe(0);
  });
});
