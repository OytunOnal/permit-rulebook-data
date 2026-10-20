import type { LogEvent } from "./run-says.js";

/**
 * The one shape of a log line: one JSON object per line, stamped with `ts`.
 * An error goes to standard error, everything else to standard output.
 */
export function print(event: LogEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: event.level, msg: event.msg, ...event.fields });
  if (event.level === "error") console.error(line);
  else console.log(line);
}
