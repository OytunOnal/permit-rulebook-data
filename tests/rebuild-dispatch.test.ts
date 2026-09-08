import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Two defects in the watch workflow, pinned together because one step carries
 * both (human decisions 2026-09-08).
 *
 * The first: the watch commits a new `watch/state.json` here, and the site — a
 * separate repository — rebuilt only on a push to itself. So the dataset moved,
 * the published page did not, and its baked "RULES READ <date>" and its social
 * card's "checked daily" stayed printed while they stopped being true. The
 * "Tell the site to rebuild" step closes that: on a run that actually committed,
 * it fires a `repository_dispatch` the site listens for. It authenticates with
 * `DISPATCH_TOKEN`, because `GITHUB_TOKEN` is scoped to this repository and
 * cannot dispatch into another one — and when that secret is missing the step
 * FAILS, loudly, naming what is missing. A silent skip is how "checked daily"
 * quietly stops being true again, so the absence of a skip is pinned here as
 * hard as the presence of the dispatch.
 *
 * The second: the workflow committed as `permit-rulebook-watch
 * <watch@users.noreply.github.com>`. GitHub maps a noreply address to whichever
 * account owns the login in front of the `@`, and the login "watch" belongs to
 * a stranger — so every automated commit in this repository's history was
 * displayed as that person's work. Only the canonical github-actions[bot]
 * identity attributes automation to the automation.
 *
 * The site half of this pair is `tests/rebuild-trigger.test.ts` over there: that
 * the site listens for the event and reruns daily after this watch's hour.
 */

const workflowsDir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

/** CRLF is a checkout detail on Windows, not a fact about the file. */
const read = (path: string): string => readFileSync(path, "utf8").split("\r\n").join("\n");

const watch = read(join(workflowsDir, "watch.yml"));

/** The canonical GitHub Actions bot, said once so the two repositories agree. */
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/**
 * The lines of one named step, from its `- name:` to the next step at the same
 * indentation. Reading the block rather than the whole file is what lets the
 * ordering inside it be asserted — a guard that runs after the request it is
 * meant to guard is not a guard.
 */
function step(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `no step named "${name}"`).toBeGreaterThan(-1);
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length && !/^\s*- name: /.test(lines[end].slice(0, indent + 8))) end += 1;
  return lines.slice(start, end).join("\n");
}

describe("a new dataset state wakes the site", () => {
  const dispatch = step(watch, "Tell the site to rebuild");

  it("the persist step records whether it actually committed", () => {
    const persist = step(watch, "Persist state + flags BEFORE issue creation (nothing depends on gh succeeding)");
    expect(persist).toContain("id: persist");
    // A run that changed nothing must not claim the dataset moved.
    expect(persist).toContain('echo "committed=false" >> "$GITHUB_OUTPUT"');
    expect(persist).toContain('echo "committed=true" >> "$GITHUB_OUTPUT"');
    expect(persist).toContain('git commit -m "watch: state update');
  });

  it("and the dispatch fires only on that commit, with the type the site listens for", () => {
    expect(dispatch).toContain("steps.persist.outputs.committed == 'true'");
    // The event type is a contract with the site's `repository_dispatch`
    // trigger: renamed on one side alone, the fast path stops with no error.
    expect(dispatch).toContain('"event_type":"dataset-updated"');
    expect(dispatch).toContain("/dispatches");
    expect(dispatch).toContain("OytunOnal/permit-rulebook");
    expect(dispatch).toContain("${{ secrets.DISPATCH_TOKEN }}");
  });

  it("and it fails loudly when the token is unset — it never skips", () => {
    // No `continue-on-error`, and no `if:` that would quietly stand the step
    // down when the secret is absent: the only condition on it is the commit.
    expect(dispatch).not.toContain("continue-on-error");
    expect(dispatch.match(/^\s*if: /gm) ?? []).toHaveLength(1);

    const guard = dispatch.indexOf('if [ -z "$DISPATCH_TOKEN" ]; then');
    const error = dispatch.indexOf("::error::DISPATCH_TOKEN is not set.");
    const exit = dispatch.indexOf("exit 1");
    const request = dispatch.indexOf("curl ");
    expect(guard, "no emptiness check on DISPATCH_TOKEN").toBeGreaterThan(-1);
    expect(error, "the failure does not name the missing secret").toBeGreaterThan(guard);
    expect(exit, "the guard does not fail the run").toBeGreaterThan(error);
    expect(request, "the guard runs after the request it is meant to guard").toBeGreaterThan(exit);

    // What a person reading a red run needs: the secret's name, what the token
    // must be able to do, and where to put it.
    const message = dispatch.slice(error, exit);
    expect(message).toContain("Contents: Read and write");
    expect(message).toContain("Metadata: Read-only");
    expect(message).toContain("DISPATCH_TOKEN");
  });

  /**
   * The step failed on the missing token BEFORE the issues were opened, so
   * every run that committed new state — which is exactly every run that has
   * new flags — stopped without filing a single one. A watch that notices a
   * source moved and tells nobody is the whole promise of decision 7, broken
   * by a step order (review 2026-09-08).
   */
  it("runs last, so nothing a flag depends on sits behind a step that can fail on the token", () => {
    const names = [...watch.matchAll(/^\s*- name: (.+)$/gm)].map((m) => m[1]!.trim());
    expect(names[names.length - 1], "the dispatch is not the last step").toBe("Tell the site to rebuild");

    // Every step that acts on the flags comes before it — by position, not by
    // reputation: any step whose condition or body reads the flag collection.
    const at = (name: string) => names.indexOf(name);
    const issues = at("Open issues for new flags only");
    expect(issues, "no step opens issues for the flags").toBeGreaterThan(-1);
    expect(issues).toBeLessThan(at("Tell the site to rebuild"));
    for (const name of names) {
      if (name === "Tell the site to rebuild") continue;
      const body = step(watch, name);
      if (!body.includes("newflags") && !body.includes("flags/")) continue;
      expect(at(name), `${name} runs after a step that can fail on the token`)
        .toBeLessThan(at("Tell the site to rebuild"));
    }

    // And the issues step asks nothing of the dispatch: it is conditioned on
    // the flags alone.
    const issueStep = step(watch, "Open issues for new flags only");
    expect(issueStep).toContain("if: steps.newflags.outputs.files != ''");
    expect(issueStep).not.toContain("DISPATCH_TOKEN");
    expect(issueStep).not.toContain("dispatch");

    // Being last means an earlier failure would skip it, and a committed state
    // still has to reach the site: it runs unless the run was cancelled.
    expect(dispatch).toContain("!cancelled()");
  });

  it("and what the token needs is written down where a maintainer will look", () => {
    const contributing = read(fileURLToPath(new URL("../CONTRIBUTING.md", import.meta.url)));
    expect(contributing).toContain("### The `DISPATCH_TOKEN` secret");
    expect(contributing).toContain("fine-grained personal access token");
    expect(contributing).toContain("`Contents: Read and write`");
    expect(contributing).toContain("`Metadata: Read-only`");
    expect(contributing).toContain("`OytunOnal/permit-rulebook`");
    expect(dispatch, "the workflow does not point at the section that explains it")
      .toContain("CONTRIBUTING.md");
  });
});

describe("automated commits are attributed to the automation", () => {
  it("every workflow commits as the canonical bot, none as the account owning the login \"watch\"", () => {
    const files = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
    expect(files, "the workflow directory is empty — this case would pass vacuously").toContain("watch.yml");
    let configured = 0;
    for (const file of files) {
      const yaml = read(join(workflowsDir, file));
      // Every noreply address a workflow ACTS on is a git identity, and there
      // is exactly one this project is allowed to commit under. Comment lines
      // are prose — YAML's and the shell's alike — and the comment explaining
      // this very defect quotes the address it warns about.
      const acted = yaml.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
      for (const address of acted.match(/[^\s"']+@users\.noreply\.github\.com/g) ?? [])
        expect(address, `${file} commits as an account this project does not own`).toBe(BOT_EMAIL);
      for (const line of yaml.split("\n")) {
        const user = /git config user\.(name|email)\s+"([^"]*)"/.exec(line);
        if (!user) continue;
        configured += 1;
        expect(user[2], `${file}: ${line.trim()}`).toBe(user[1] === "name" ? BOT_NAME : BOT_EMAIL);
      }
    }
    // The workflow that commits state is the one this defect was found in; if
    // it stops setting an identity at all, that is a change worth failing on.
    expect(configured, "no workflow configures a git identity any more").toBe(2);
  });
});
