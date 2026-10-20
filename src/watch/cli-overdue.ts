import { appendFileSync, writeFileSync } from "node:fs";
import { ghExecutableOf, ghRunnerAt } from "./gh.js";
import { findingOfClock, OPEN_FLAGS_READ_LIMIT, readClock, type ClockReading } from "./overdue.js";
import { print } from "./print.js";
import type { LogEvent } from "./run-says.js";

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
 * `overdue flags` with. Everything it decides is in `overdue.ts`.
 *
 * Exit 0 when it read the clock, clear or overdue: an overdue flag reddens the
 * run at the workflow's last step, behind `watch run failed`, because it is
 * not the check failing. Exit 1 when it did not: the tracker, its answer or the
 * arguments could not be read, and that is the check not finishing.
 */

const FLAGS = ["--finding-file", "--run-url", "--step-output"] as const;
type Flag = typeof FLAGS[number];

/** The three paths and the url, or why the command line was refused. */
function readArgs(argv: readonly string[]): Record<Flag, string> | string {
  const given: Partial<Record<Flag, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = FLAGS.find((f) => f === argv[i]);
    if (!flag || !argv[i + 1]) return `${argv[i]} is not an argument this CLI takes, or has no value`;
    given[flag] = argv[i + 1];
  }
  const missing = FLAGS.filter((f) => !given[f]);
  return missing.length ? `${missing.join(", ")} needed` : (given as Record<Flag, string>);
}

function clockEvent(reading: ClockReading, today: string): LogEvent {
  if (reading.kind === "unread") return { level: "error", msg: "overdue clock: the tracker could not be read", fields: { reason: reading.reason } };
  return {
    level: reading.kind === "overdue" ? "error" : "info",
    msg: "overdue clock",
    fields: {
      today,
      open: reading.open,
      overdue: reading.kind === "overdue" ? reading.overdue.map((f) => ({ number: f.number, raised: f.raised, days: f.days })) : [],
    },
  };
}

async function readOpenFlags(today: string): Promise<ClockReading> {
  const gh = ghExecutableOf(process.env["PATH"] ?? "", process.cwd());
  if (!gh) return { kind: "unread", reason: "gh is not in an absolute PATH folder outside the working directory" };
  try {
    const listed = await ghRunnerAt(gh)([
      "issue", "list", "--label", "source-change", "--state", "open",
      "--json", "number,title,createdAt", "--limit", String(OPEN_FLAGS_READ_LIMIT),
    ]);
    return readClock(listed, today);
  } catch (e) {
    return { kind: "unread", reason: `the tracker's open flags could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const args = readArgs(process.argv.slice(2));
if (typeof args === "string") {
  print({ level: "error", msg: "overdue clock: the arguments were refused", fields: { reason: args } });
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const reading = await readOpenFlags(today);
print(clockEvent(reading, today));
writeFileSync(args["--finding-file"], JSON.stringify(findingOfClock(reading, args["--run-url"])) + "\n");
appendFileSync(args["--step-output"], `reading=${reading.kind}\n`);
process.exit(reading.kind === "unread" ? 1 : 0);
