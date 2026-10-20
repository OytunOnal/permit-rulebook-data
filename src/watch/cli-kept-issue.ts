import { ghExecutableOf, ghRunnerAt } from "./gh.js";
import { keepIssue } from "./keep-issue.js";
import { print } from "./print.js";

/**
 * The kept-issue CLI (#117): one command a workflow step runs to keep its
 * issue. It reads the tracker through `gh`, decides through
 * `actionOnKeptIssue`, and runs the argument lists `ghArgumentsOf` gives, with
 * no shell. Everything it decides is in `keep-issue.ts` and `kept-issue.ts`.
 *
 *   node dist/src/watch/cli-kept-issue.js
 *     --title <text>               the issue's exact title
 *     --label <name>               the label it lives under
 *     --label-color <hex>          the label's colour, and
 *     --label-description <text>   its description, for when the run creates it
 *   and the run's finding, one of:
 *     --finding red --body <text>         comment, or create, or reopen + comment
 *     --finding green --closing <text>    close an open issue with this line
 *     --finding unsaid                    leave the issue as it is
 *     --finding-file <path>               a JSON RunFinding a step before wrote
 *   (`--body` and `--closing` may both be given; the finding uses its own.)
 *
 * `gh` is found in PATH's absolute folders, never in the working directory or
 * below it, and reads its token and repository from its own environment
 * (`GH_TOKEN`, and `GH_REPO` or the checkout).
 *
 * Exit 0: the issue was kept (or there was nothing to do). Exit 1: it was not:
 * the arguments were refused, `gh` was not found, the tracker could not be
 * read, or a `gh` command failed. Its log line says which.
 */

const gh = ghExecutableOf(process.env["PATH"] ?? "", process.cwd());
if (!gh) {
  print({ level: "error", msg: "kept issue: gh is not in an absolute PATH folder outside the working directory", fields: {} });
  process.exit(1);
}
const run = await keepIssue(process.argv.slice(2), ghRunnerAt(gh));
for (const event of run.events) print(event);
process.exit(run.exitCode);
