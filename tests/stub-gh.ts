import { afterEach, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * What the tracker CLIs' tests share: throwaway folders, and the real CLI run
 * as a child process with a stub `gh` first on PATH (#117, seam 5's third part).
 */

/** A folder maker for one test file: each folder is new, in the OS temp folder, and removed after its case. */
export function tempFoldersRemovedAfterEach(prefix: string): () => string {
  const made: string[] = [];
  afterEach(() => { for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true }); });
  return () => {
    const folder = mkdtempSync(join(tmpdir(), prefix));
    made.push(folder);
    return folder;
  };
}

/**
 * Whether the child-process cases skip here, said out loud when they do. The
 * stub is a shell script, which Windows runs only through a shell, and the CLIs
 * run `gh` with none: so they run on Linux, where CI runs them, and under CI
 * they never skip.
 */
export function childProcessCasesSkipped(cli: string): boolean {
  const skipped = process.platform === "win32" && !process.env["CI"];
  if (skipped) console.log(`${cli}: the child-process cases are SKIPPED — a stub gh needs Linux`);
  return skipped;
}

/**
 * Records each call's arguments NUL-separated, a call ended by \x01, and
 * answers a tracker read with `$GH_LIST_ANSWER`.
 */
const STUB = [
  // bash, whose printf writes a NUL where dash's may not.
  "#!/bin/bash",
  "printf '%s\\0' \"$@\" >> \"$GH_RECORD\"",
  "printf '\\001\\0' >> \"$GH_RECORD\"",
  "if [ \"$1 $2\" = \"issue list\" ]; then printf '%s' \"$GH_LIST_ANSWER\"; fi",
].join("\n") + "\n";

/** The argument lists the stub recorded, in order. */
const callsIn = (record: string): string[][] => {
  if (!existsSync(record)) return [];
  return readFileSync(record, "utf8").split("\0").slice(0, -1).reduce<string[][]>((calls, arg) => {
    if (arg === "\x01") calls.push([]);
    else calls[calls.length - 1]!.push(arg);
    return calls;
  }, [[]]).slice(0, -1);
};

/** What a CLI run against the stub exited with, what it printed on stderr, what reached the stub, and the folder it ran in. */
export interface StubbedRun { status: number | null; stderr: string; calls: string[][]; underCheck: string }

/**
 * A runner of built CLI entries against the stub, each run in a folder of its
 * own with the stub first on PATH, the tracker read answered with `listAnswer`.
 */
export function stubGhRunner(tempFolder: () => string) {
  return (entry: string, args: readonly string[], listAnswer = "[]"): StubbedRun => {
    expect(existsSync(entry), `${entry} is not built: npm run check builds it`).toBe(true);
    const stubFolder = tempFolder();
    writeFileSync(join(stubFolder, "gh"), STUB);
    chmodSync(join(stubFolder, "gh"), 0o755);
    const underCheck = tempFolder();
    const record = join(tempFolder(), "calls");
    const run = spawnSync(process.execPath, [entry, ...args], {
      cwd: underCheck,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubFolder}${delimiter}${process.env["PATH"] ?? ""}`,
        GH_RECORD: record,
        GH_LIST_ANSWER: listAnswer,
        // Should a real gh ever answer in the stub's place, it can write nowhere.
        GH_TOKEN: "not-a-token",
        GH_REPO: "no-such-owner-for-a-test/no-such-repository",
      },
    });
    return { status: run.status, stderr: run.stderr, calls: callsIn(record), underCheck };
  };
}
