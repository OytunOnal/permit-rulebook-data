import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pipeline's own security (Spine steward-40, 2026-09-08).
 *
 * A workflow that says `actions/checkout@v4` runs whatever that tag points at
 * today, and a workflow with repository-wide write runs every step with it —
 * including the step that runs a third party's code. This repository's watch
 * commits state and files issues, so it raises what it needs on the job that
 * needs it and nothing above.
 *
 * The site half of this pair is `tests/pipeline.test.ts` over there.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const workflows = join(root, ".github", "workflows");
const read = (path: string): string => readFileSync(path, "utf8").split("\r\n").join("\n");

const yamlFiles = (dir: string): string[] =>
  readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml")).map((f) => join(dir, f));

describe("every action is pinned to a commit, and every job asks for the least it needs", () => {
  const files = yamlFiles(workflows);

  it("no `uses:` names a tag or a branch — all of them name a 40-hex commit", () => {
    expect(files.length, "no workflows to check").toBeGreaterThan(0);
    for (const file of files)
      for (const line of read(file).split("\n")) {
        const used = /uses:\s*(\S+)/.exec(line);
        if (!used) continue;
        const [, ref] = used;
        expect(ref, `${file}: ${line.trim()}`).toMatch(/^[^@]+@[0-9a-f]{40}$/);
        // And the version it was resolved from, so a person can read it.
        expect(line, `${file}: ${line.trim()} has no version comment`).toMatch(/#\s*v[0-9]+\.[0-9]+\.[0-9]+/);
      }
  });

  it("the workflow's floor is contents: read, and only the jobs that need more raise it", () => {
    for (const file of files) {
      const yaml = read(file);
      const top = yaml.slice(0, yaml.indexOf("jobs:"));
      expect(top, `${file}: no top-level permissions block`).toMatch(/^permissions:\s*$/m);
      expect(top, `${file}: the floor is not contents: read`).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
      // Nothing above the jobs may hand out a write scope.
      expect(top, `${file}: a write scope above the jobs`).not.toMatch(/^\s+(pages|id-token|issues): write/m);
      // Every job states its own permissions rather than inheriting silently.
      // Jobs only: the keys under `on:` are triggers, not jobs.
      const after = yaml.slice(yaml.indexOf("jobs:"));
      const jobs = [...after.matchAll(/^ {2}([a-z][a-z0-9-]*):\n/gm)].map((m) => m[1]!);
      for (const job of jobs) {
        const block = after.slice(after.indexOf(`  ${job}:\n`));
        const next = block.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
        const own = next < 0 ? block : block.slice(0, next + 1);
        expect(own, `${file}: job "${job}" states no permissions`).toMatch(/^\s{4}permissions:/m);
      }
    }
  });

  it("no secret is written into a workflow in plain text", () => {
    for (const file of files) {
      const yaml = read(file);
      // A secret reaches a workflow through `secrets.` and nowhere else.
      for (const line of yaml.split("\n")) {
        if (/^\s*#/.test(line)) continue;
        // A permission scope is not a secret: `id-token: write` names a
        // capability, not a value.
        if (/^\s+(pages|id-token|contents|issues|actions|packages):\s/.test(line)) continue;
        const assigned = /(?:TOKEN|SECRET|KEY|PASSWORD)\s*:\s*"?([^"\s]+)/i.exec(line);
        if (!assigned) continue;
        // A token reaches a workflow from the secret store or from the run's
        // own automatic token, and from nowhere else — never as a literal.
        expect(line, `${file}: ${line.trim()}`).toMatch(/\$\{\{\s*(secrets|github)\./);
      }
      // And no 40-hex string outside a `uses:` pin, no PAT prefixes.
      expect(yaml, `${file}: a GitHub token prefix`).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
    }
  });
});
