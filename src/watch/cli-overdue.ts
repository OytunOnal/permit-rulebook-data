import { ghRunnerFromPath } from "./cli-shared.js";
import { readClockOnFlags } from "./overdue-command.js";
import { print } from "./print.js";

/**
 * The clock on a flag, read once a morning (#62).
 *
 *   node dist/src/watch/cli-overdue.js
 *     --finding-file <path>   where the finding for `overdue flags` goes (a JSON RunFinding)
 *     --run-url <url>         the run the finding links
 *     --step-output <path>    the step's $GITHUB_OUTPUT, given `reading=clear|overdue|unread`
 *
 * It reads the tracker's open `source-change` flags through `gh`, reads the
 * clock, logs one line, and writes the finding the kept-issue CLI keeps
 * `overdue flags` with. Everything it decides is in `overdue-command.ts` and
 * `overdue.ts`.
 *
 * Exit 0 when it read the clock, clear or overdue: an overdue flag reddens the
 * run at the workflow's last step, behind `watch run failed`, because it is
 * not the check failing. Exit 1 when it did not: `gh` was not found, or the
 * tracker, its answer or the arguments could not be read, and that is the
 * check not finishing.
 */

const runGh = ghRunnerFromPath();
if (typeof runGh === "string") {
  print({ level: "error", msg: `overdue clock: ${runGh}`, fields: {} });
  process.exit(1);
}
const run = await readClockOnFlags(process.argv.slice(2), runGh, new Date().toISOString().slice(0, 10));
for (const event of run.events) print(event);
process.exit(run.exitCode);
