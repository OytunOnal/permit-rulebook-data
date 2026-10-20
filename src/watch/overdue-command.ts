import { appendFileSync, writeFileSync } from "node:fs";
import { messageOf, readArguments } from "./cli-io.js";
import type { GhRunner } from "./gh.js";
import { findingOfClock, OPEN_FLAGS_READ_LIMIT, readClock, type ClockReading } from "./overdue.js";
import type { LogEvent } from "./print.js";

/**
 * The clock's CLI as a function (#62, #117 decision 15): it reads the open
 * flags through `runGh`, reads the clock on `today`, writes the finding the
 * kept-issue CLI keeps `overdue flags` with, and gives the step its
 * `reading=`. `cli-overdue.ts` gives it the real `gh`; the arguments are
 * written there.
 */

/** What one run of the clock's CLI did: the lines it logs and the code it exits with. */
export interface ClockRun { events: LogEvent[]; exitCode: 0 | 1 }

const ARGUMENTS = { required: ["--label", "--finding-file", "--run-url", "--step-output"] };

export async function readClockOnFlags(argv: readonly string[], runGh: GhRunner, today: string): Promise<ClockRun> {
  const args = readArguments(argv, ARGUMENTS);
  if (typeof args === "string") {
    return { events: [{ level: "error", msg: "overdue clock: the arguments were refused", fields: { reason: args } }], exitCode: 1 };
  }
  const reading = await readOpenFlags(args.get("--label")!, runGh, today);
  const read = clockEvent(reading, today);
  try {
    writeFileSync(args.get("--finding-file")!, JSON.stringify(findingOfClock(reading, args.get("--run-url")!)) + "\n");
    appendFileSync(args.get("--step-output")!, `reading=${reading.kind}\n`);
  } catch (e) {
    return { events: [read, { level: "error", msg: "overdue clock: the reading could not be handed on", fields: { reason: messageOf(e) } }], exitCode: 1 };
  }
  return { events: [read], exitCode: reading.kind === "unread" ? 1 : 0 };
}

/** The clock on the open issues under `label`, the flags' own. */
async function readOpenFlags(label: string, runGh: GhRunner, today: string): Promise<ClockReading> {
  try {
    const listed = await runGh([
      "issue", "list", "--label", label, "--state", "open",
      "--json", "number,title,createdAt", "--limit", String(OPEN_FLAGS_READ_LIMIT),
    ]);
    return readClock(listed, today);
  } catch (e) {
    return { kind: "unread", reason: `the tracker's open flags could not be read: ${messageOf(e)}` };
  }
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
