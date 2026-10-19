import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { readText, stepNamesOf, stepOf, watchYaml as watch, workflowFiles, workflowsDir } from "./workflow-text.js";

/**
 * The toolchain the watch runs on, held to the decisions of #24's grill
 * (2026-10-19).
 *
 * The dependencies are audited on every run (#47): the test runner's two
 * critical advisories (#83) sat in this repository from the v1.2.0 release
 * until a person ran `npm audit` by hand. And the runner image is named, never
 * `-latest`: `ubuntu-latest` moved to a new Ubuntu under a scheduled run, and
 * the browser tier reads the image's own Chrome.
 */

/** The one step that runs `npm audit`, by its name; a step that only says the words is not it. */
function auditStep(): { name: string; body: string } {
  const names = stepNamesOf(watch).filter((name) => /^\s*run:\s*npm audit\b/m.test(stepOf(watch, name)));
  expect(names, "no step, or more than one, runs npm audit").toHaveLength(1);
  return { name: names[0]!, body: stepOf(watch, names[0]!) };
}

describe("the dependencies are audited on every run (#47)", () => {
  it("over every installed dependency, dev ones included, red at high and above", () => {
    const { body } = auditStep();
    // The test runner runs in CI and the watch's job holds a write token, so
    // a dev dependency is not out of reach: nothing is left out of the read.
    expect(body).toMatch(/npm audit\b.*--audit-level=high\b/);
    expect(body).not.toMatch(/--omit|--production|--only/);
  });

  it("after the install it reads, and before the sources are read", () => {
    const { name } = auditStep();
    expect(watch.indexOf("npm ci"), "the audit reads a tree not yet installed")
      .toBeLessThan(watch.indexOf(`- name: ${name}`));
    const names = stepNamesOf(watch);
    expect(names.indexOf(name)).toBeLessThan(names.indexOf("Watch sources"));
  });

  it("a red audit makes the run red and never stops its work", () => {
    const { name, body } = auditStep();
    // The audit itself does not stop the job: the sources are still read, the
    // state committed and the flags filed, whatever the advisories say.
    expect(body).toContain("continue-on-error: true");
    const id = /^\s*id:\s*(\S+)\s*$/m.exec(body)?.[1];
    expect(id, `${name} has no id for a later step to read`).toBeDefined();

    // One later step re-raises it.
    const names = stepNamesOf(watch);
    const gates = names.filter((n) => stepOf(watch, n).includes(`steps.${id}.outcome == 'failure'`));
    expect(gates, "nothing turns a failed audit into a red run").toHaveLength(1);
    const gate = gates[0]!;
    expect(stepOf(watch, gate)).toContain("exit 1");

    // And it stands where a failure skips no work: every step behind it runs
    // whatever failed before (`!cancelled()` or `failure()`), and the failure
    // notice is among them, so the red run opens its issue.
    for (const later of names.slice(names.indexOf(gate) + 1))
      expect(stepOf(watch, later), `${later} is skipped by a red audit`).toMatch(/!cancelled\(\)|failure\(\)/);
    expect(names.indexOf("Say so when the run fails")).toBeGreaterThan(names.indexOf(gate));
  });
});

describe("the runner image is named, never -latest", () => {
  it("every job of every workflow runs on a pinned image", () => {
    let jobs = 0;
    for (const file of workflowFiles)
      for (const [, image] of readText(join(workflowsDir, file)).matchAll(/^\s*runs-on:\s*(\S+)/gm)) {
        jobs += 1;
        expect(image, `${file} runs on an image that moves under it`).not.toMatch(/-latest$/);
      }
    expect(jobs, "no job found — this case would pass vacuously").toBeGreaterThan(0);
  });
});
