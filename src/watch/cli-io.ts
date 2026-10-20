import { lstatSync, readFileSync } from "node:fs";
import { ghExecutableOf, ghRunnerAt, type GhRunner } from "./gh.js";

/**
 * What the tracker CLIs share (#117): how a command line is read, how a file
 * from outside is read, how an error is said, and where `gh` is found.
 */

/** What a thrown value says, whatever was thrown. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The names a command line may give, and which of them it must. */
export interface ArgumentNames { required: readonly string[]; optional?: readonly string[] }

/**
 * Each argument's value by its name, or why the command line was refused.
 * Every argument is a name this CLI takes followed by one value, and no value
 * is empty; each required name is given.
 */
export function readArguments(argv: readonly string[], names: ArgumentNames): ReadonlyMap<string, string> | string {
  const known = [...names.required, ...(names.optional ?? [])];
  const given = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]!;
    const value = argv[i + 1];
    if (!known.includes(name)) return `${name} is not an argument this CLI takes`;
    if (!value) return `${name} has no value`;
    given.set(name, value);
  }
  const missing = names.required.filter((name) => !given.has(name));
  return missing.length ? `${missing.join(", ")} needed` : given;
}

/** A file's text, or why it was not read; `missing` when nothing is at the path. */
export type BoundedRead = { kind: "read"; text: string } | { kind: "refused"; reason: string; missing: boolean };

/** A regular file's text, read only when it is no link, no folder, and no larger than `limitBytes`. */
export function readBoundedFile(path: string, limitBytes: number): BoundedRead {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return { kind: "refused", reason: `${path} is not a file`, missing: false };
    if (stat.size > limitBytes) return { kind: "refused", reason: `${path} is larger than ${limitBytes} bytes`, missing: false };
    return { kind: "read", text: readFileSync(path, "utf8") };
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    return { kind: "refused", reason: `${path} could not be read: ${messageOf(e)}`, missing };
  }
}

/**
 * A runner for the `gh` in PATH's absolute folders outside the working
 * directory, or the line that says there is none.
 */
export function ghRunnerFromPath(): GhRunner | string {
  const gh = ghExecutableOf(process.env["PATH"] ?? "", process.cwd());
  return gh ? ghRunnerAt(gh) : "gh is not in an absolute PATH folder outside the working directory";
}
