import { readFileSync } from "node:fs";
import { readClock, type ClockReading } from "./overdue.js";

/**
 * The clock on a flag, read once a morning (#62).
 *
 * Given the tracker's open `source-change` flags on standard input — the JSON
 * of `gh issue list --json number,title,createdAt` — it writes the body of the
 * `overdue flags` issue to standard output when there is one to write, its own
 * log line to standard error, and exits with the code below. Everything it
 * decides is in `overdue.ts`; this file only reads, prints and exits.
 */

/**
 * The one place a reading becomes an exit code, and the three codes
 * `watch.yml` tells apart: clear closes an open `overdue flags` issue, overdue
 * turns the run red and names the flags there, unread is the check not
 * finishing — `watch run failed` — and leaves `overdue flags` as it was.
 */
const EXIT: Record<ClockReading["kind"], number> = { clear: 0, overdue: 1, unread: 2 };

const today = new Date().toISOString().slice(0, 10);
let reading: ClockReading;
try {
  reading = readClock(readFileSync(0, "utf8"), today);
} catch {
  reading = { kind: "unread", reason: "standard input could not be read" };
}

const line = reading.kind === "unread"
  ? { level: "error", msg: "overdue clock: the tracker could not be read", reason: reading.reason }
  : {
    level: reading.kind === "overdue" ? "error" : "info",
    msg: "overdue clock",
    today,
    open: reading.open,
    overdue: reading.kind === "overdue" ? reading.overdue.map((f) => ({ number: f.number, raised: f.raised, days: f.days })) : [],
  };
console.error(JSON.stringify({ ts: new Date().toISOString(), ...line }));
if (reading.kind === "overdue") process.stdout.write(reading.body + "\n");
process.exit(EXIT[reading.kind]);
