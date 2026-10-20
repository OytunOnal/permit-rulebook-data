import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readText, stepOf, workflowFiles, workflowsDir } from "./workflow-text.js";

/**
 * The data repository checks itself (#117, decisions 8, 9 and 16).
 *
 * The only place a red data master showed was the site's deploy, one
 * repository away: the watch turned `s8` red on 10-09 and nothing here ran a
 * test. The watch pushes with the workflow token, which cannot start a
 * workflow from its own push, so the check also runs after every watch run,
 * on master's head. After a watch run, and only then, a red check keeps
 * `check failed on master` and the first green one closes it: a push and a
 * pull request have a person at the other end.
 *
 * Read as text, the way the watch's tests read it (`workflow-text.ts`): which
 * runs trigger it, what each job may write, and which run keeps the issue.
 */

const checkYaml = (): string => readText(join(workflowsDir, "check.yml"));
const watchYaml = (): string => readText(join(workflowsDir, "watch.yml"));

const indentOf = (line: string): number => line.search(/\S/);
const withoutComment = (text: string): string => text.replace(/\s+#.*$/, "").trim();

/**
 * The lines nested under `path`, one key per level, found by indentation; a
 * small reader rather than a YAML parser, which this package does not ship.
 * Comment and blank lines are dropped. Undefined when a key is absent.
 */
function linesAt(yaml: string, path: string[]): string[] | undefined {
  let lines = yaml.split("\n").filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  for (const key of path) {
    const depth = Math.min(...lines.map(indentOf));
    const at = lines.findIndex((line) => indentOf(line) === depth && line.trim().startsWith(`${key}:`));
    if (at < 0) return undefined;
    const end = lines.findIndex((line, i) => i > at && indentOf(line) <= depth);
    lines = lines.slice(at + 1, end < 0 ? undefined : end);
  }
  return lines;
}

/** The keys directly under `path`, in order. */
function keysAt(yaml: string, path: string[]): string[] {
  const lines = linesAt(yaml, path);
  expect(lines, `no ${path.join(".")}`).toBeDefined();
  const depth = Math.min(...lines!.map(indentOf));
  return lines!.filter((line) => indentOf(line) === depth).map((line) => /^\s*([^:]+):/.exec(line)![1]!.trim());
}

/** The text after `path`'s last key on its own line, comment dropped. */
function scalarAt(yaml: string, path: string[]): string {
  const parent = path.length > 1 ? linesAt(yaml, path.slice(0, -1)) : yaml.split("\n");
  expect(parent, `no ${path.slice(0, -1).join(".")}`).toBeDefined();
  const key = path[path.length - 1]!;
  const lines = parent!.filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  const depth = Math.min(...lines.map(indentOf));
  const line = lines.find((l) => indentOf(l) === depth && l.trim().startsWith(`${key}:`));
  expect(line, `no ${path.join(".")}`).toBeDefined();
  return withoutComment(line!.trim().slice(key.length + 1));
}

/** A flow list (`[a, b]`) or a block list (`- a`) under `path`, as its items. */
function listAt(yaml: string, path: string[]): string[] {
  const inline = scalarAt(yaml, path);
  if (inline.startsWith("[")) return inline.slice(1, -1).split(",").map((item) => item.trim().replace(/^["']|["']$/g, ""));
  return (linesAt(yaml, path) ?? []).map((line) => withoutComment(line.trim().replace(/^- /, "")).replace(/^["']|["']$/g, ""));
}

describe("the data check runs where a red would otherwise be silent", () => {
  it("on a push to master, on every pull request, and after every watch run", () => {
    const yaml = checkYaml();
    expect(keysAt(yaml, ["on"])).toEqual(["push", "pull_request", "workflow_run"]);
    expect(listAt(yaml, ["on", "push", "branches"])).toEqual(["master"]);
    // Every pull request, whatever branch it targets.
    expect(linesAt(yaml, ["on", "pull_request"])).toEqual([]);
    // After the watch, whatever its conclusion: a watch run that went red, or
    // committed nothing, can still leave master red (user story 18).
    expect(listAt(yaml, ["on", "workflow_run", "workflows"])).toEqual(["source-watch"]);
    expect(listAt(yaml, ["on", "workflow_run", "types"])).toEqual(["completed"]);
    // A watch run on master, the one that commits master's state; a branch
    // run's baseline is checked by that branch's pull request.
    expect(listAt(yaml, ["on", "workflow_run", "branches"])).toEqual(["master"]);
  });

  it("never runs a pull request with this repository's write token", () => {
    // `pull_request_target` runs with the base repository's token, and a
    // check runs the pull request's own code (decision 16).
    expect(workflowFiles, "no workflows — this case would pass vacuously").toContain("check.yml");
    for (const file of workflowFiles)
      expect(readText(join(workflowsDir, file)), `${file} names pull_request_target`).not.toContain("pull_request_target");
  });
});

/** Every `uses:` reference in a text, in order. */
const actionsOf = (yaml: string): string[] => [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);

/** Every `run:` command of one job, in order, one-line commands only. */
const commandsOf = (yaml: string, job: string): string[] =>
  (linesAt(yaml, ["jobs", job, "steps"]) ?? [])
    .map((line) => /^\s*-?\s*run:\s*(.+)$/.exec(line)?.[1])
    .filter((command): command is string => command !== undefined && command.trim() !== "|")
    .map(withoutComment);

describe("the check job reads, and only reads", () => {
  it("holds contents: read alone, on the watch's named image, with the watch's pinned actions", () => {
    const yaml = checkYaml();
    expect(linesAt(yaml, ["jobs", "check", "permissions"])?.map((line) => line.trim())).toEqual(["contents: read"]);
    // Named, so the browser cases drive the image's own Chrome, as the watch's.
    expect(scalarAt(yaml, ["jobs", "check", "runs-on"])).toBe("ubuntu-26.04");
    const used = actionsOf(linesAt(yaml, ["jobs", "check"])!.join("\n"));
    expect(used.length, "the check job uses no action").toBeGreaterThan(0);
    for (const action of used) expect(actionsOf(watchYaml()), `${action} is not the watch's`).toContain(action);
  });

  it("installs from the lockfile and runs the whole check", () => {
    expect(commandsOf(checkYaml(), "check")).toEqual(["npm ci", "npm run check"]);
  });
});

describe("the check workflow is one GitHub can read", () => {
  it("writes no one-line run: that YAML would read as a mapping", () => {
    // These tests read the file as text, so a file GitHub refuses passed them
    // all: a plain scalar holding ": " is a YAML error, and GitHub then runs
    // no job at all. Words with a colon go through a quoted `env:` value.
    const runs = [...checkYaml().matchAll(/^\s*-?\s*run:\s*([^|>\s].*)$/gm)].map((m) => m[1]!);
    expect(runs.length, "no one-line run: — this case would pass vacuously").toBeGreaterThan(0);
    for (const run of runs) expect(run, run).not.toMatch(/:\s/);
  });
});

/** A job's `if:`, without the `${{ }}` a workflow may wrap it in. */
const jobConditionOf = (yaml: string, job: string): string =>
  scalarAt(yaml, ["jobs", job, "if"]).replace(/^\$\{\{/, "").replace(/\}\}$/, "").trim();

describe("after a watch run, and only then, the check keeps `check failed on master`", () => {
  it("reports after the check job whatever its result, on workflow_run only", () => {
    const yaml = checkYaml();
    expect(scalarAt(yaml, ["jobs", "report", "needs"])).toBe("check");
    // `always()`: a red or unfinished check is exactly what it reports. The
    // event: a push and a pull request have a person at the other end, so
    // their reds file nothing (decision 9).
    expect(jobConditionOf(yaml, "report")).toBe("always() && github.event_name == 'workflow_run'");
  });

  it("holds issues: write, and is the only job that does", () => {
    const yaml = checkYaml();
    expect(linesAt(yaml, ["jobs", "report", "permissions"])?.map((line) => line.trim()))
      .toEqual(["contents: read", "issues: write"]);
    for (const job of keysAt(yaml, ["jobs"]).filter((name) => name !== "report"))
      expect(linesAt(yaml, ["jobs", job, "permissions"])?.join("\n"), `job ${job} can write`).not.toMatch(/: write/);
    expect(scalarAt(yaml, ["jobs", "report", "runs-on"])).toBe("ubuntu-26.04");
    for (const action of actionsOf(linesAt(yaml, ["jobs", "report"])!.join("\n")))
      expect(actionsOf(watchYaml()), `${action} is not the watch's`).toContain(action);
  });

  it("keeps the issue through the kept-issue CLI, with the check job's result as the finding", () => {
    const step = stepOf(checkYaml(), "Keep check failed on master");
    expect(step).toMatch(/run: node dist\/src\/watch\/cli-kept-issue\.js /);
    expect(step).toContain('--title "check failed on master"');
    expect(step).toContain("--label check ");
    // Green only on a check that passed; anything else, an unfinished check
    // included, is red. The value reaches the command through the
    // environment, one of two literals.
    expect(step).toContain("FINDING: \"${{ needs.check.result == 'success' && 'green' || 'red' }}\"");
    expect(step).toContain('--finding "$FINDING"');
  });
});
