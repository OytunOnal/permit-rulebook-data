export type LogLevel = "info" | "warn" | "error";

/** One log line before it is printed: `print` stamps `ts` on it. */
export interface LogEvent {
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

/**
 * The one shape of a log line: one JSON object per line, stamped with `ts`.
 * An error goes to standard error, everything else to standard output.
 */
export function print(event: LogEvent): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: event.level, msg: event.msg, ...event.fields });
  if (event.level === "error") console.error(line);
  else console.log(line);
}
