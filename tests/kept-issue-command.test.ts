import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, relative as relativePath } from "node:path";
import { fileURLToPath } from "node:url";
import { keepIssue } from "../src/watch/kept-issue-command.js";
import { ghExecutableOf, type GhRunner } from "../src/watch/gh.js";

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

const keptIssueArgs = (title = "overdue flags") => [
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
    await keepIssue([...keptIssueArgs(), ...green], tracker.runGh);
    expect(tracker.calls[0]).toEqual(expect.arrayContaining(["issue", "list", "--label", "watch", "--state", "all", "--limit"]));
    expect(tracker.calls.filter((c) => c[1] === "list")).toHaveLength(1);
  });

  it("creates the label, then the issue, on a red run with no such issue", async () => {
    const tracker = trackerAnswering("[]");
    const run = await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([
      ["label", "create", "watch", "--color", "b60205", "--description", "The daily source watch itself", "--force"],
      ["issue", "create", "--title", "overdue flags", "--label", "watch", "--body", "Flags no person has walked."],
    ]);
    expect(run.exitCode).toBe(0);
  });

  it("comments on the open issue on a red run", async () => {
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "comment", "40", "--body", "Flags no person has walked."]]);
    expect(run.exitCode).toBe(0);
  });

  it("reopens the closed issue, then comments, on a red run", async () => {
    const tracker = trackerAnswering(closedIssue);
    await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "reopen", "40"], ["issue", "comment", "40", "--body", "Flags no person has walked."]]);
  });

  it("closes the open issue on a green run", async () => {
    const tracker = trackerAnswering(openIssue);
    const run = await keepIssue([...keptIssueArgs(), ...green], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "close", "40", "--comment", "No overdue flag this morning."]]);
    expect(run.exitCode).toBe(0);
  });

  it("writes nothing when there is nothing to do", async () => {
    const tracker = trackerAnswering(closedIssue);
    const run = await keepIssue([...keptIssueArgs(), ...green], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(0);
    const unsaid = trackerAnswering(openIssue);
    expect((await keepIssue([...keptIssueArgs(), "--finding", "unsaid"], unsaid.runGh)).exitCode).toBe(0);
    expect(unsaid.writes()).toEqual([]);
  });

  it("fails, writing nothing, when the tracker's answer cannot be read", async () => {
    const tracker = trackerAnswering("<html>rate limited</html>");
    const run = await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(1);
    expect(run.events).toContainEqual(expect.objectContaining({ level: "error" }));
  });

  it("fails, writing nothing, when the tracker cannot be asked", async () => {
    const tracker = trackerAnswering("[]", "list");
    const run = await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([]);
    expect(run.exitCode).toBe(1);
  });

  it("fails, and stops, when a write does not go through", async () => {
    const tracker = trackerAnswering(closedIssue, "reopen");
    const run = await keepIssue([...keptIssueArgs(), ...red], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "reopen", "40"]]);
    expect(run.exitCode).toBe(1);
  });

  it("hands gh a hostile title and body intact, each one argument", async () => {
    const title = "flags $(touch pwned) `id` \"quoted\" 'single'; rm -rf ~";
    const body = "line one\n$(touch pwned)\n`id` \"q\" 'q' && echo done";
    const tracker = trackerAnswering("[]");
    await keepIssue([...keptIssueArgs(title), "--finding", "red", "--body", body], tracker.runGh);
    expect(tracker.writes()[1]).toEqual(["issue", "create", "--title", title, "--label", "watch", "--body", body]);
  });

  it("takes the finding from a file, as the clock writes it", async () => {
    const file = join(tempFolder(), "finding.json");
    writeFileSync(file, JSON.stringify({ kind: "red", body: "From the clock.\n\nRun: https://example.test/runs/1\n" }));
    const tracker = trackerAnswering(openIssue);
    await keepIssue([...keptIssueArgs(), "--finding-file", file], tracker.runGh);
    expect(tracker.writes()).toEqual([["issue", "comment", "40", "--body", "From the clock.\n\nRun: https://example.test/runs/1\n"]]);
  });

  it.each([
    ["no title", ["--label", "watch", "--label-color", "b60205", "--label-description", "D", ...red]],
    ["no finding", keptIssueArgs()],
    ["a finding it does not know", [...keptIssueArgs(), "--finding", "amber"]],
    ["a red finding with no body", [...keptIssueArgs(), "--finding", "red"]],
    ["an argument it does not know", [...keptIssueArgs(), ...red, "--repo", "someone/else"]],
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
    const run = await keepIssue([...keptIssueArgs(), "--finding-file", file], tracker.runGh);
    expect(tracker.calls).toEqual([]);
    expect(run.exitCode).toBe(1);
  });
});

/**
 * Part 2: `gh` is found from PATH's absolute folders only, never from a
 * relative one and never from the folder under check, where anything the
 * checked-out code planted would sit (Security: an outside program).
 */
describe("ghExecutableOf — where gh is found", () => {
  const GH = process.platform === "win32" ? "gh.exe" : "gh";
  const withGh = (folder: string) => {
    writeFileSync(join(folder, GH), "#!/bin/sh\n");
    chmodSync(join(folder, GH), 0o755);
    return folder;
  };
  const pathOf = (...folders: string[]) => folders.join(delimiter);

  it("finds it in the first absolute folder on PATH that holds it", () => {
    const empty = tempFolder();
    const first = withGh(tempFolder());
    const second = withGh(tempFolder());
    expect(ghExecutableOf(pathOf(empty, first, second), tempFolder())).toBe(join(first, GH));
  });

  it("never in a relative folder, even one that holds it", () => {
    const relative = relativePath(process.cwd(), withGh(tempFolder()));
    expect(isAbsolute(relative), "the case needs a relative way to the folder").toBe(false);
    const absolute = withGh(tempFolder());
    expect(ghExecutableOf(pathOf("", ".", relative, absolute), tempFolder())).toBe(join(absolute, GH));
  });

  it("never in the folder under check, nor in a folder inside it", () => {
    const underCheck = withGh(tempFolder());
    const inside = join(underCheck, "node_modules", ".bin");
    mkdirSync(inside, { recursive: true });
    withGh(inside);
    const outside = withGh(tempFolder());
    expect(ghExecutableOf(pathOf(underCheck, inside, outside), underCheck)).toBe(join(outside, GH));
  });

  it("finds none when no absolute folder outside the one under check holds it", () => {
    const underCheck = withGh(tempFolder());
    expect(ghExecutableOf(pathOf(tempFolder(), underCheck), underCheck)).toBeUndefined();
  });
});

/**
 * Part 3: the real CLI, as a child process, with a stub `gh` first on PATH.
 * The stub is a shell script, which Windows runs only through a shell, and the
 * CLI runs `gh` with none: so this case runs on Linux, where CI runs it, and a
 * local Windows run skips it out loud. Under CI it never skips.
 */
const CI = Boolean(process.env["CI"]);
const cannotRunStub = process.platform === "win32";
if (cannotRunStub && !CI) console.log("kept-issue CLI: the child-process case is SKIPPED — a stub gh needs Linux");

describe.skipIf(cannotRunStub && !CI)("the kept-issue CLI as a child process", () => {
  const entry = fileURLToPath(new URL("../dist/src/watch/cli-kept-issue.js", import.meta.url));

  /** Records each call's arguments NUL-separated, a call ended by \x01; answers the read with no issues. */
  const STUB = [
    // bash, whose printf writes a NUL where dash's may not.
    "#!/bin/bash",
    "printf '%s\\0' \"$@\" >> \"$GH_RECORD\"",
    "printf '\\001\\0' >> \"$GH_RECORD\"",
    "if [ \"$1 $2\" = \"issue list\" ]; then printf '[]'; fi",
  ].join("\n") + "\n";

  const callsIn = (record: string): string[][] =>
    readFileSync(record, "utf8").split("\0").slice(0, -1).reduce<string[][]>((calls, arg) => {
      if (arg === "\x01") calls.push([]);
      else calls[calls.length - 1]!.push(arg);
      return calls;
    }, [[]]).slice(0, -1);

  it("runs gh with no shell: a hostile title reaches the stub intact, after the read and the label", () => {
    expect(existsSync(entry), "the CLI is not built: npm run build").toBe(true);
    const stubFolder = tempFolder();
    writeFileSync(join(stubFolder, "gh"), STUB);
    chmodSync(join(stubFolder, "gh"), 0o755);
    const underCheck = tempFolder();
    const record = join(tempFolder(), "calls");
    const title = "flags $(touch pwned) `touch pwned` \"quoted\" 'single'; touch pwned";

    const run = spawnSync(process.execPath, [
      entry, "--title", title, "--label", "watch", "--label-color", "b60205",
      "--label-description", "The daily source watch itself", "--finding", "red", "--body", "Body; $(touch pwned)",
    ], {
      cwd: underCheck,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubFolder}${delimiter}${process.env["PATH"] ?? ""}`,
        GH_RECORD: record,
        // Should a real gh ever answer in the stub's place, it can write nowhere.
        GH_TOKEN: "not-a-token",
        GH_REPO: "no-such-owner-for-a-test/no-such-repository",
      },
    });

    expect(run.status, run.stderr).toBe(0);
    expect(callsIn(record)).toEqual([
      ["issue", "list", "--label", "watch", "--state", "all", "--json", "number,state,title", "--limit", "100"],
      ["label", "create", "watch", "--color", "b60205", "--description", "The daily source watch itself", "--force"],
      ["issue", "create", "--title", title, "--label", "watch", "--body", "Body; $(touch pwned)"],
    ]);
    expect(existsSync(join(underCheck, "pwned")), "a title or body was run as a command").toBe(false);
  });
});
