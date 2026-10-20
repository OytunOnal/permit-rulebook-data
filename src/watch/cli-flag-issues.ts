import { fileFlagIssues } from "./flag-issues.js";
import { ghRunnerFromPath } from "./cli-shared.js";
import { print } from "./print.js";

/**
 * The flag-filing CLI (#117 decision 14): the one command the watch runs,
 * after its state is pushed, to file an issue for each new flag. Everything
 * it decides is in `flag-issues.ts`; `gh` runs with no shell.
 *
 *   node dist/src/watch/cli-flag-issues.js
 *     --list <path>                the list of this run's new flags the watch's CLI wrote
 *     --flags-dir <path>           the folder the flag files are in
 *     --label <name>               the label each issue is filed under
 *     --label-color <hex>          the label's colour, and
 *     --label-description <text>   its description, for when the run creates it
 *
 * `gh` is found in PATH's absolute folders, never in the working directory or
 * below it, and reads its token and repository from its own environment
 * (`GH_TOKEN`, and `GH_REPO` or the checkout).
 *
 * Exit 0: every flag on the list was filed (none, on a morning with none).
 * Exit 1: the arguments or the list were refused and nothing was filed, `gh`
 * was not found, or a flag could not be filed; every other flag still was.
 * Its log lines say which.
 */

const runGh = ghRunnerFromPath();
if (typeof runGh === "string") {
  print({ level: "error", msg: `flag issues: ${runGh}`, fields: {} });
  process.exit(1);
}
const run = await fileFlagIssues(process.argv.slice(2), runGh);
for (const event of run.events) print(event);
process.exit(run.exitCode);
