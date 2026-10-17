/**
 * The clock on a flag (#62).
 *
 * The watch files a flag and stops; a flag nobody reads stays open, and in
 * October five of them did, for up to ten days, while the site said a person
 * reads them (#12). What reached the human that week was a red run. So a flag
 * no person has walked by the second morning after the day it was raised turns
 * the morning red, as a refusal by us does: waiting another day changes
 * nothing about a flag nobody is reading.
 *
 * The count is in UTC days and not in hours. The 05:17 schedule has filed its
 * flags anywhere between 09:47 and 12:07 UTC, and a clock of 48 hours would
 * keep the promise of two days on some mornings and three on others, chosen by
 * how late GitHub started the run.
 */

/** One open flag, as the tracker lists it. */
export interface OpenFlag {
  number: number;
  title: string;
  /** When the flag was raised, an ISO 8601 timestamp. */
  createdAt: string;
}

/** A flag past its two days, with the age that makes it so. */
export interface OverdueFlag {
  number: number;
  title: string;
  /** The UTC day it was raised. */
  raised: string;
  /** Whole UTC days from the day it was raised to today. */
  days: number;
}

/** The days a flag has before the morning that finds it unread turns red. */
export const OVERDUE_AFTER_DAYS = 2;

const DAY_MS = 86_400_000;

/** The UTC day of a timestamp, whatever offset it was written with. */
const utcDay = (timestamp: string) => new Date(timestamp).toISOString().slice(0, 10);

/**
 * The open flags that are overdue on `today` (a UTC day, `YYYY-MM-DD`), oldest
 * first. A flag raised on the 16th is overdue on the 18th and not on the 17th.
 */
export function overdueFlags(open: readonly OpenFlag[], today: string): OverdueFlag[] {
  return open
    .map((f) => {
      const raised = utcDay(f.createdAt);
      const days = Math.round((Date.parse(today) - Date.parse(raised)) / DAY_MS);
      return { number: f.number, title: f.title, raised, days };
    })
    .filter((f) => f.days >= OVERDUE_AFTER_DAYS)
    .sort((a, b) => b.days - a.days || a.number - b.number);
}

/**
 * What the morning's run is told, from the tracker's list of open flags.
 *
 * `code` is the CLI's exit code, and the workflow does a different thing for
 * each: 0 closes an open `overdue flags` issue, 1 turns the run red and says
 * which flags in that issue, 2 is the check not finishing — `watch run failed`
 * — and leaves `overdue flags` as it was. A list the clock cannot make sense
 * of is a tracker it did not read; answering 0 to it would be the silent skip
 * that lets "read within two days" quietly stop being true.
 */
export type ClockReading =
  | { code: 0; open: number }
  | { code: 1; open: number; overdue: OverdueFlag[]; body: string }
  | { code: 2; reason: string };

const isOpenFlag = (f: unknown): f is OpenFlag => {
  if (typeof f !== "object" || f === null) return false;
  const { number, title, createdAt } = f as Record<string, unknown>;
  return Number.isInteger(number) && typeof title === "string"
    && typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt));
};

/** `listed` is the tracker's answer as text; `today` a UTC day, `YYYY-MM-DD`. */
export function readClock(listed: string, today: string): ClockReading {
  let open: unknown;
  try {
    open = JSON.parse(listed);
  } catch {
    return { code: 2, reason: "the tracker's answer is not JSON" };
  }
  if (!Array.isArray(open)) return { code: 2, reason: "the tracker's answer is not a list" };
  if (!open.every(isOpenFlag)) return { code: 2, reason: "a flag in the tracker's answer has no number, title or day" };

  const overdue = overdueFlags(open, today);
  if (!overdue.length) return { code: 0, open: open.length };
  const body = [
    `Flags no person has walked by the second morning after the day they were raised (${today}):`,
    "",
    ...overdue.map((f) => `- #${f.number} ${f.title} — raised ${f.raised}, ${f.days} days`),
  ].join("\n");
  return { code: 1, open: open.length, overdue, body };
}
