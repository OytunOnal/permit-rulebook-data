import { execFile } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve, sep } from "node:path";

/**
 * The `gh` adapter every tracker step goes through (#117 decision 12): where
 * `gh` is found, and how it is run. No shell stands between an argument and
 * `gh`, so a title or a body is never read as a command.
 */

/** `gh`'s argument list → what it printed on standard output; rejects when `gh` fails. */
export type GhRunner = (args: readonly string[]) => Promise<string>;

/** Windows compares folder names without case. */
const comparablePathOf = (folder: string) => (process.platform === "win32" ? resolve(folder).toLowerCase() : resolve(folder));

const isExecutableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    // Not there, or not runnable: this folder does not hold gh.
    return false;
  }
};

/**
 * The first `gh` (`gh.exe` on Windows) in PATH's absolute folders, never in a
 * relative one, and never in the folder under check or a folder inside it,
 * where anything the checked-out code planted would sit.
 */
export function ghExecutableOf(pathValue: string, folderUnderCheck: string): string | undefined {
  const name = process.platform === "win32" ? "gh.exe" : "gh";
  const checked = comparablePathOf(folderUnderCheck);
  for (const folder of pathValue.split(delimiter)) {
    if (!isAbsolute(folder)) continue;
    const at = comparablePathOf(folder);
    if (at === checked || at.startsWith(checked.endsWith(sep) ? checked : checked + sep)) continue;
    if (isExecutableFile(join(folder, name))) return join(folder, name);
  }
  return undefined;
}

/** What one `gh` call may print, and how long it may take. */
const GH_OUTPUT_LIMIT_BYTES = 4_194_304;
const GH_TIMEOUT_MS = 120_000;

/** A runner that calls the `gh` at `ghPath` with an argument list and no shell. */
export function ghRunnerAt(ghPath: string): GhRunner {
  return (args) => new Promise((done, fail) => {
    execFile(ghPath, [...args], { shell: false, maxBuffer: GH_OUTPUT_LIMIT_BYTES, timeout: GH_TIMEOUT_MS }, (error, stdout, stderr) => {
      if (error) fail(new Error(`${error.message.split("\n")[0]}${stderr ? ` — ${stderr.trim()}` : ""}`));
      else done(stdout);
    });
  });
}
