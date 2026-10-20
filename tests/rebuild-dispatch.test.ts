import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  conditionOf, KEPT_ISSUE_CLI_COPY, oneLineCommandsOf, readText, stepNamesOf, stepOf, watchYaml as watch, workflowFiles,
  workflowsDir,
} from "./workflow-text.js";

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

/** The canonical GitHub Actions bot, said once so the two repositories agree. */
const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

/**
 * The `workflow_dispatch` inputs and what each one defaults to.
 *
 * A small reader rather than a YAML parser, because this package ships one
 * dependency and it is not a YAML parser. It reads the block by its own
 * structure — indentation relative to `inputs:` — so a reordering or a
 * reindentation of the file does not fail a test about which switches exist.
 */
function dispatchInputs(yaml: string): Record<string, string> {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s*inputs:\s*$/.test(line));
  expect(start, "the workflow declares no dispatch inputs").toBeGreaterThan(-1);
  const indent = lines[start]!.search(/\S/);
  const found: Record<string, string> = {};
  let current: string | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const depth = line.search(/\S/);
    if (depth <= indent) break;
    const name = /^\s*([A-Za-z_][\w-]*):\s*$/.exec(line);
    if (name && depth === indent + 2) { current = name[1]!; found[current] = ""; continue; }
    const fallback = /^\s*default:\s*(\S+)\s*$/.exec(line);
    if (fallback && current) found[current] = fallback[1]!;
  }
  return found;
}

/**
 * Would that condition fire, given these facts?
 *
 * Enough of GitHub's expression language for the conditions this workflow
 * writes: `&&` of terms, each `!cancelled()`, `failure()`, `success()`, or a
 * path compared with `==`/`!=` to a literal. `failure()` and `success()` read
 * the fact `job.status`. A fact nobody supplies is absent — which is what
 * `github.event.inputs.x` IS on a schedule, and the reason every guard in this
 * file is written `!= 'false'`.
 */
function fires(condition: string, facts: Record<string, string>): boolean {
  return condition.split("&&").map((t) => t.trim()).every((term) => {
    if (term === "!cancelled()") return true;
    if (term === "failure()") return facts["job.status"] === "failure";
    if (term === "success()") return facts["job.status"] === "success";
    const compared = /^([\w.]+)\s*(==|!=)\s*'([^']*)'$/.exec(term);
    expect(compared, `this test cannot read the term ${term}`).not.toBeNull();
    const [, path, operator, value] = compared!;
    const actual = facts[path!];
    return operator === "==" ? actual === value : actual !== value;
  });
}

/**
 * The finding a step hands the kept-issue CLI, given the job's status when the
 * step runs. Enough of the expression language for the one shape it is
 * written in: `job.status == '<status>' && '<finding>' || '<otherwise>'`.
 */
function findingOn(step: string, jobStatus: string): string {
  const written = /^\s*FINDING:\s*"\$\{\{\s*job\.status\s*==\s*'(\w+)'\s*&&\s*'(\w+)'\s*\|\|\s*'(\w+)'\s*\}\}"\s*$/m.exec(step);
  expect(written, "the step hands the CLI no finding read from the job's status").not.toBeNull();
  const [, status, finding, otherwise] = written!;
  return jobStatus === status ? finding! : otherwise!;
}

/** The value a step's one-line `run:` command gives an argument, as written; undefined when it gives none. */
function argumentOf(step: string, name: string): string | undefined {
  const command = /^\s*run:\s*(.+)$/m.exec(step)?.[1] ?? "";
  return new RegExp(`(?:^|\\s)${name}\\s+("[^"]*"|\\S+)`).exec(command)?.[1];
}

/** The lines of the job's own `env:`, trimmed, comments dropped. */
function linesUnderJobEnv(yaml: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^ {4}env:\s*$/.test(line));
  expect(start, "the job has no env").toBeGreaterThan(-1);
  const end = lines.findIndex((line, i) => i > start && line.trim() !== "" && !/^\s*#/.test(line) && line.search(/\S/) <= 4);
  return lines.slice(start + 1, end < 0 ? undefined : end)
    .filter((line) => line.trim() !== "" && !/^\s*#/.test(line))
    .map((line) => line.trim());
}

describe("a new dataset state wakes the site", () => {
  const dispatch = stepOf(watch,"Tell the site to rebuild");

  it("the persist step records whether it actually committed", () => {
    const persist = stepOf(watch,"Persist state + flags BEFORE issue creation (nothing depends on gh succeeding)");
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
    const names = stepNamesOf(watch);
    // The dispatch is the last step that DOES anything; the only thing after it
    // is the notice that says whether a step failed — including the dispatch
    // itself, when its token has expired (Standards review, 2026-09-08). Behind
    // the notice stands only the overdue gate, which acts on nothing (#62).
    expect(names[names.length - 1], "the overdue gate is not last").toBe("Fail the run on an overdue flag");
    expect(names[names.length - 2], "the failure notice is not behind every acting step").toBe("Say so when the run fails");
    expect(names[names.length - 3], "the dispatch is not the last acting step").toBe("Tell the site to rebuild");

    // Every step that acts on the flags comes before it — by position, not by
    // reputation: any step whose condition or body names the flags folder.
    // The failure notice is exempt: it runs after everything.
    const at = (name: string) => names.indexOf(name);
    const issues = at("Open issues for new flags only");
    expect(issues, "no step opens issues for the flags").toBeGreaterThan(-1);
    expect(issues).toBeLessThan(at("Tell the site to rebuild"));
    for (const name of names) {
      if (name === "Tell the site to rebuild" || name === "Say so when the run fails") continue;
      const body = stepOf(watch,name);
      if (!body.includes("watch/flags")) continue;
      expect(at(name), `${name} runs after a step that can fail on the token`)
        .toBeLessThan(at("Tell the site to rebuild"));
    }

    // And the issues step asks nothing of the step that can fail on the token:
    // it is conditioned on the switch that says this run records nothing at
    // all — never on the dispatch or its secret. (The two assertions below
    // read `not.toContain("dispatch")` until 2026-09-23; the word is now a
    // dispatch INPUT's name and appears in this step's own condition, so the
    // check names the two things it always meant.)
    const issueStep = stepOf(watch,"Open issues for new flags only");
    expect(issueStep).not.toContain("DISPATCH_TOKEN");
    expect(issueStep).not.toContain("steps.persist");

    // Being last means an earlier failure would skip it, and a committed state
    // still has to reach the site: it runs unless the run was cancelled.
    expect(dispatch).toContain("!cancelled()");
  });

  it("and what the token needs is written down where a maintainer will look", () => {
    const contributing = readText(fileURLToPath(new URL("../CONTRIBUTING.md", import.meta.url)));
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
    expect(workflowFiles, "the workflow directory is empty — this case would pass vacuously").toContain("watch.yml");
    let configured = 0;
    for (const file of workflowFiles) {
      const yaml = readText(join(workflowsDir, file));
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

/**
 * Three runs failed in a row and nobody heard: 09-03 and 09-05 died collecting
 * the flags (the step handed `head` a directory), 09-06 on a source timeout,
 * and not one issue was filed — while the flags those runs wrote sat in the
 * repository unread (devils-advocate, 2026-09-08).
 */
describe("a red run is never silent", () => {
  it("leaves the schedule's path exactly as it was when the dispatch switches were added", () => {
    // s34 gave `workflow_dispatch` two booleans — `commit` and `dispatch` — so
    // the watch could be run once to be timed and once to write baselines on a
    // branch. The daily run passes no inputs at all, and the way that goes
    // wrong is silent: on a `schedule` event `github.event.inputs` is null, and
    // `inputs.commit == false` is TRUE for a null, so the obvious spelling
    // would have stopped the morning run ever committing again and nothing
    // would have said so.
    //
    // The decision, then: every condition that reads a dispatch input must be
    // written so that the absent value takes the ACTING branch. That is what is
    // checked — the shape of each guard, not the sentence any of them is in.
    const guards = [...watch.matchAll(/github\.event\.inputs\.(\w+)\s*(==|!=)\s*'([^']*)'/g)]
      .filter((m) => !/^\s*#/.test(watch.slice(watch.lastIndexOf("\n", m.index!) + 1, m.index!)));
    expect(guards.length, "no step reads a dispatch input").toBeGreaterThan(0);
    for (const [whole, input, operator, value] of guards)
      expect(
        `${operator} ${value}`,
        `${whole} — a null input (the schedule) does not take the acting branch of this guard`,
      ).toBe("!= false");
    // And both switches are declared with the daily run's own behaviour as
    // their default, so a hand dispatch that changes nothing behaves as today.
    // The decision, not the layout: which inputs exist and what each defaults
    // to. How they are indented, what order they are written in and how many
    // lines they take are the file's business.
    expect(dispatchInputs(watch)).toEqual({ commit: "true", dispatch: "true" });
    for (const input of Object.keys(dispatchInputs(watch)))
      expect(guards.some((g) => g[1] === input), `${input} is declared and never read`).toBe(true);
  });

  it("cannot tell the site to rebuild from anywhere but master", () => {
    // A `workflow_dispatch` on a branch with commit=true pushes state to that
    // branch, and this step would then tell the site to pin it — and the
    // site's handler checks only that the sha is forty hex characters before
    // it deploys and writes it into `data.lock`. This slice's own baseline
    // runs were one untouched input away from pinning the live site to data
    // that was not on master (Security review, 2026-09-24). The input is a
    // switch a person can forget; the ref is not.
    //
    // Asked of the condition itself rather than of its wording: the same four
    // facts, run through it, in the shapes that matter.
    const when = conditionOf(watch, "Tell the site to rebuild");
    const committed = { "steps.persist.outputs.committed": "true" };
    expect(fires(when, { "github.ref": "refs/heads/master", ...committed }),
      "the daily run on master does not dispatch").toBe(true);
    expect(fires(when, { "github.ref": "refs/heads/s34-browser-strategy", ...committed }),
      "a branch run dispatches").toBe(false);
    expect(fires(when, { "github.ref": "refs/heads/master", "github.event.inputs.dispatch": "false", ...committed }),
      "dispatch=false is ignored").toBe(false);
    expect(fires(when, { "github.ref": "refs/heads/master" }),
      "a run that committed nothing still dispatches").toBe(false);
  });

  it("keeps watch run failed through the kept-issue CLI: red on a red run, green on a green one, with the run's link", () => {
    const names = stepNamesOf(watch);
    const say = stepOf(watch,"Say so when the run fails");
    // One command, so what it does to the issue is decided in the kept-issue
    // module (#117) and nowhere in this file's shell.
    const command = /^\s*run:\s*(.+)$/m.exec(say);
    expect(command, "the step runs no single command").not.toBeNull();
    expect(command![1]).toMatch(/^node \S+\/cli-kept-issue\.js --title "watch run failed" --label "\$WATCH_LABEL" .*--finding "\$FINDING"/);
    expect(findingOn(say, "failure"), "a red run does not say so").toBe("red");
    expect(findingOn(say, "success"), "a green run does not close the issue").toBe("green");
    expect(say).toContain("actions/runs/${{ github.run_id }}");
    // It sits after everything that can fail, or it cannot see the failure.
    // After everything, the dispatch included — everything but the overdue
    // gate, which stands behind it so that it is NOT seen (#62): an overdue
    // flag is red, but it is not the check failing, and it has its own issue.
    expect(names.indexOf("Say so when the run fails")).toBe(names.length - 2);
    expect(names.indexOf("Say so when the run fails"))
      .toBeGreaterThan(names.indexOf("Tell the site to rebuild"));
    const gate = stepOf(watch,"Fail the run on an overdue flag");
    expect(gate).not.toContain("gh ");
  });

  /**
   * A green morning closes `watch run failed` as a red one keeps it (#117,
   * decision 10), so the step runs on both; a measurement run leaves nothing
   * behind, so it neither opens nor closes it.
   */
  it("keeps watch run failed on a red and on a green morning, never on a measurement run", () => {
    const when = conditionOf(watch, "Say so when the run fails");
    const onMaster = { "github.ref": "refs/heads/master" };
    for (const status of ["failure", "success"]) {
      expect(fires(when, { "job.status": status, ...onMaster }), `a ${status} morning leaves the issue alone`).toBe(true);
      expect(fires(when, { "job.status": status, "github.event.inputs.commit": "false", ...onMaster }),
        `a ${status} measurement run keeps the issue`).toBe(false);
    }
  });

  /**
   * Only a run on the default branch keeps `watch run failed` (the ruling on
   * PR #36's review): a branch run's green would say the morning's run had
   * recovered, and its red would raise the alarm for a run nobody waits on.
   */
  it("never keeps watch run failed from a run on another branch", () => {
    const when = conditionOf(watch, "Say so when the run fails");
    for (const status of ["failure", "success"])
      expect(fires(when, { "job.status": status, "github.ref": "refs/heads/s34-browser-strategy" }),
        `a ${status} branch run keeps the issue`).toBe(false);
  });

  /**
   * An overdue flag is `overdue flags`'s to say (#117, user story 24). The
   * clock's own step stays green on overdue (#118), and the gate that reddens
   * the run on it stands behind this step, so on a morning where only the clock
   * is red the job is still green here, and the finding with it.
   */
  it("does not let an overdue flag alone make watch run failed's finding red", () => {
    const names = stepNamesOf(watch);
    const say = stepOf(watch, "Say so when the run fails");
    const gates = names.filter((name) => {
      const step = stepOf(watch, name);
      return step.includes("steps.clock.outputs.reading == 'overdue'") && step.includes("exit 1");
    });
    expect(gates, "no step reddens the run on an overdue flag").toEqual(["Fail the run on an overdue flag"]);
    expect(names.indexOf(gates[0]!), "the overdue gate runs before the finding is read")
      .toBeGreaterThan(names.indexOf("Say so when the run fails"));
    expect(findingOn(say, "success"), "a morning red only on the clock is not green here").toBe("green");
  });

  /**
   * The clock (#62), kept through the kept-issue CLI (#117): it reads after the
   * state is pushed, and not on a measurement run; `overdue flags` is spoken to
   * only on a reading the clock could make, so an unread clock leaves it as it
   * was; and the overdue gate stands behind `watch run failed`, so an overdue
   * flag alone never files it.
   */
  it("reads the clock after the push, keeps overdue flags on a reading, and gates last", () => {
    const names = stepNamesOf(watch);
    const at = (name: string) => names.indexOf(name);
    const order = [
      "Persist state + flags BEFORE issue creation (nothing depends on gh succeeding)",
      "Read the clock on open flags",
      "Say which flags are overdue",
      "Say so when the run fails",
      "Fail the run on an overdue flag",
    ];
    for (const name of order) expect(at(name), `no step named "${name}"`).toBeGreaterThan(-1);
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
    expect(conditionOf(watch, "Read the clock on open flags")).toBe("!cancelled() && github.event.inputs.commit != 'false'");
    expect(conditionOf(watch, "Say which flags are overdue"))
      .toBe("!cancelled() && (steps.clock.outputs.reading == 'overdue' || steps.clock.outputs.reading == 'clear')");
    expect(conditionOf(watch, "Fail the run on an overdue flag")).toBe("!cancelled() && steps.clock.outputs.reading == 'overdue'");
    expect(stepOf(watch, "Read the clock on open flags")).toContain("id: clock");
  });

  /** The clock writes the finding `overdue flags` is kept with; a drifted path would keep it never. */
  it("keeps overdue flags with the finding the clock wrote, at one path outside the repository", () => {
    const written = argumentOf(stepOf(watch, "Read the clock on open flags"), "--finding-file");
    expect(written).toMatch(/^"\$RUNNER_TEMP\//);
    expect(argumentOf(stepOf(watch, "Say which flags are overdue"), "--finding-file")).toBe(written);
  });

  /**
   * A label's look is written once in the job and read by every step that
   * keeps or files under it, so `label create --force` paints it the same
   * whichever step runs last, and the clock reads the flags under the label
   * they are filed under.
   */
  it("writes each label's look once, and every step under a label reads it from there", () => {
    const underALabel = stepNamesOf(watch).filter((name) => /\s--label\s/.test(stepOf(watch, name)));
    expect(underALabel.length, "no step keeps or files under a label").toBeGreaterThan(0);
    for (const name of underALabel) {
      const step = stepOf(watch, name);
      const label = /^"\$(\w+)_LABEL"$/.exec(argumentOf(step, "--label") ?? "");
      expect(label, `${name} names its label in place`).not.toBeNull();
      for (const [argument, suffix] of [["--label-color", "_COLOR"], ["--label-description", "_DESCRIPTION"]] as const) {
        const value = argumentOf(step, argument);
        if (value !== undefined) expect(value, `${name}'s ${argument}`).toBe(`"$${label![1]}_LABEL${suffix}"`);
      }
    }
    const env = linesUnderJobEnv(watch);
    for (const variable of new Set([...watch.matchAll(/"\$(\w+_LABEL(?:_COLOR|_DESCRIPTION)?)"/g)].map((m) => m[1]!)))
      expect(env.filter((line) => line.startsWith(`${variable}:`)), `${variable} is not written once in the job's env`).toHaveLength(1);
    expect(argumentOf(stepOf(watch, "Read the clock on open flags"), "--label"), "the clock reads another label than the flags'")
      .toBe(argumentOf(stepOf(watch, "Open issues for new flags only"), "--label"));
    expect(argumentOf(stepOf(watch, "Say which flags are overdue"), "--label"))
      .toBe(argumentOf(stepOf(watch, "Say so when the run fails"), "--label"));
  });

  it("and it says what a failure means, which is not that a source changed", () => {
    const say = stepOf(watch,"Say so when the run fails");
    expect(say).toContain("it says the check did not finish");
  });
});

/**
 * The dispatch used to carry `$GITHUB_SHA` — the commit the run STARTED from,
 * not the state it had just pushed. The site pins the data commit it builds
 * against, so that walked the lock backwards to before the new state existed
 * (Security review, 2026-09-08).
 */
describe("the dispatch names the state it just committed", () => {
  it("the persist step publishes the commit it made", () => {
    const persist = stepOf(watch,"Persist state + flags BEFORE issue creation (nothing depends on gh succeeding)");
    expect(persist).toContain('echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"');
  });

  it("and the dispatch sends that, through the environment", () => {
    const dispatch = stepOf(watch,"Tell the site to rebuild");
    expect(dispatch).toContain('STATE_SHA: "${{ steps.persist.outputs.sha }}"');
    expect(dispatch).toContain('"sha":"%s"');
    expect(dispatch).toContain('"$STATE_SHA"');
    // Never the run's starting commit.
    expect(dispatch).not.toContain("$GITHUB_SHA");
  });

});

/**
 * Flag issues (#117 decision 14). Which issues are filed is decided in the
 * CLIs, where a test reaches it, and in no step's shell: the watch's CLI writes
 * this run's new flags to a list outside the repository, and after the push
 * one CLI files an issue per flag on it, the title from the list.
 */
describe("flag issues are filed after the push, from the list the watch writes", () => {
  const PERSIST = "Persist state + flags BEFORE issue creation (nothing depends on gh succeeding)";
  const FILING = "Open issues for new flags only";
  const commandOf = (name: string): string => {
    const command = /^\s*run:\s*(.+)$/m.exec(stepOf(watch, name));
    expect(command, `${name} runs no single command`).not.toBeNull();
    return command![1]!;
  };

  it("files them after the state is pushed, with one command, from the list the watch's CLI wrote", () => {
    const names = stepNamesOf(watch);
    const order = ["Watch sources", PERSIST, FILING].map((name) => names.indexOf(name));
    expect(order.every((at) => at > -1), "a step is missing").toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    const filing = commandOf(FILING);
    expect(filing).toMatch(/^node dist\/src\/watch\/cli-flag-issues\.js /);
    const list = /--list "([^"]+)"/.exec(filing)?.[1];
    expect(list, "the filing step names no list").toBeDefined();
    // In the runner's temporary folder: outside the repository, so the push never carries it.
    expect(list).toMatch(/^\$RUNNER_TEMP\//);
    expect(commandOf("Watch sources"), "the watch writes its list somewhere else").toContain(`--new-flags="${list}"`);
  });

  it("files them on a morning whose push went through, never on a measurement run", () => {
    const when = conditionOf(watch, FILING);
    expect(fires(when, { "job.status": "success" }), "the daily run files no flag issue").toBe(true);
    expect(fires(when, { "job.status": "success", "github.event.inputs.commit": "false" }),
      "a measurement run files flag issues").toBe(false);
    expect(fires(when, { "job.status": "failure" }), "a run whose push failed files flag issues").toBe(false);
  });

  it("leaves no step collecting the flags in bash", () => {
    expect(stepNamesOf(watch).filter((name) => name.startsWith("Collect NEW flags"))).toEqual([]);
    expect(watch).not.toContain("steps.newflags");
  });
});

/**
 * A master whose build breaks must not silence `watch run failed` (the ruling
 * on #117, (a)): the kept-issue CLI is built on its own, from its own files,
 * before anything else can fail, and the steps that keep an issue run that copy.
 */
describe("a broken build elsewhere cannot silence a kept issue", () => {
  it("builds the kept-issue CLI on its own, right after the install, before the repository's build", () => {
    const commands = oneLineCommandsOf(watch);
    expect(commands.slice(0, 2)).toEqual(["npm ci", "npm run build:kept-issue"]);
    expect(commands.indexOf("npm run build"), "the repository's build runs before the CLI's own")
      .toBeGreaterThan(commands.indexOf("npm run build:kept-issue"));
  });

  it("keeps both of the watch's issues with that copy", () => {
    for (const name of ["Say so when the run fails", "Say which flags are overdue"]) {
      const command = /^\s*run:\s*(.+)$/m.exec(stepOf(watch, name))?.[1] ?? "";
      expect(command.startsWith(`node ${KEPT_ISSUE_CLI_COPY} `), `${name} runs ${command}`).toBe(true);
    }
  });

  it("builds that copy from a config of its own, at the path the steps run", () => {
    const packageJson = JSON.parse(readText(fileURLToPath(new URL("../package.json", import.meta.url))));
    const config = /^tsc -p (\S+)$/.exec(packageJson.scripts["build:kept-issue"] ?? "");
    expect(config, "build:kept-issue is not one tsc build").not.toBeNull();
    const tsconfig = JSON.parse(readText(fileURLToPath(new URL(`../${config![1]}`, import.meta.url))));
    // Its own files only: nothing the repository's other sources hold is swept in.
    expect(tsconfig.include).toEqual([]);
    expect(tsconfig.files).toContain("src/watch/cli-kept-issue.ts");
    expect(`${tsconfig.compilerOptions.outDir}/src/watch/cli-kept-issue.js`).toBe(KEPT_ISSUE_CLI_COPY);
  });
});
