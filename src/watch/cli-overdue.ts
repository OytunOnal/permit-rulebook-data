import { readFileSync } from "node:fs";
import { readClock } from "./overdue.js";

/**
 * The clock on a flag, read once a morning (#62).
 *
 * Given the tracker's open `source-change` flags on standard input — the JSON
 * of `gh issue list --json number,title,createdAt` — it writes the body of the
 * `overdue flags` issue to standard output when there is one to write, its own
 * log line to standard error, and exits with the reading's code: 0 nothing
 * overdue, 1 overdue, 2 the tracker's answer could not be read. Everything it
 * decides is in `overdue.ts`; this file only reads, prints and exits.
 */

let listed: string;
try {
  listed = readFileSync(0, "utf8");
} catch {
  listed = "";
}
const today = new Date().toISOString().slice(0, 10);
const reading = readClock(listed, today);

const line = reading.code === 2
  ? { level: "error", msg: "overdue clock: the tracker could not be read", reason: reading.reason }
  : {
    level: reading.code === 1 ? "error" : "info",
    msg: "overdue clock",
    today,
    open: reading.open,
    overdue: reading.code === 1 ? reading.overdue.map((f) => ({ number: f.number, raised: f.raised, days: f.days })) : [],
  };
console.error(JSON.stringify({ ts: new Date().toISOString(), ...line }));
if (reading.code === 1) process.stdout.write(reading.body + "\n");
process.exit(reading.code);
