import { join } from "node:path";
import { messageOf, readArguments, readBoundedFile } from "./cli-io.js";
import type { GhRunner } from "./gh.js";
import { ghArgumentsOf, type LabelLook } from "./kept-issue.js";
import type { LogEvent } from "./print.js";
import type { FlagDocument } from "./run-says.js";

/**
 * The flag-filing CLI as a function (#117 decision 14): after the state is
 * pushed, it files one issue per flag on the list the watch's CLI wrote, the
 * title from the list, the body from the flag's file, through `runGh` and the
 * argument lists `ghArgumentsOf` gives. `cli-flag-issues.ts` gives it the real
 * `gh`; the arguments are written there.
 */

/** One flag on the list the watch hands the filing step: its file's name, and its issue's title. */
export interface NewFlag { file: string; title: string }

/**
 * The most flags one list may hold. A run gives each watch entry at most one
 * flag, and the watchlist holds fewer entries than this; a longer list is
 * refused whole, never cut.
 */
export const NEW_FLAGS_LIMIT = 100;

/** The list of this run's new flags, as the watch's CLI writes it. */
export function newFlagsListOf(flags: readonly FlagDocument[]): string {
  return JSON.stringify(flags.map((f): NewFlag => ({ file: f.name, title: f.title }))) + "\n";
}

/** What one run of the flag-filing CLI did: the lines it logs and the code it exits with. */
export interface FlagIssuesRun { events: LogEvent[]; exitCode: 0 | 1 }

/** What the command line asks: the list, the folder its files are in, and the label they are filed under. */
interface FilingRequest { list: string; flagsDir: string; label: string; labelLook: LabelLook }

const ARGUMENTS = { required: ["--list", "--flags-dir", "--label", "--label-color", "--label-description"] };

export async function fileFlagIssues(argv: readonly string[], runGh: GhRunner): Promise<FlagIssuesRun> {
  const request = readRequest(argv);
  if (typeof request === "string") return { events: [{ level: "error", msg: "flag issues: the arguments were refused", fields: { reason: request } }], exitCode: 1 };
  const flags = readList(request.list);
  if (typeof flags === "string") return { events: [{ level: "error", msg: "flag issues: the list was refused", fields: { reason: flags } }], exitCode: 1 };
  if (!flags.length) return { events: [{ level: "info", msg: "flag issues: no new flag to file", fields: {} }], exitCode: 0 };
  const events: LogEvent[] = [];
  for (const flag of flags) events.push(await fileOne(flag, request, runGh));
  return { events, exitCode: events.some((e) => e.level === "error") ? 1 : 0 };
}

/** The tracker's limit on an issue's body is 65,536 characters; a flag file of more bytes may not fit whole. */
export const FLAG_FILE_LIMIT_BYTES = 65_536;

/** One flag filed, or why it was not: one flag that cannot be filed does not stop the others. */
async function fileOne(flag: NewFlag, request: FilingRequest, runGh: GhRunner): Promise<LogEvent> {
  const body = readBoundedFile(join(request.flagsDir, flag.file), FLAG_FILE_LIMIT_BYTES);
  if (body.kind === "refused") return { level: "error", msg: "flag issue: the flag's file was refused", fields: { file: flag.file, reason: body.reason } };
  const action = { kind: "create" as const, title: flag.title, label: request.label, body: body.text };
  for (const args of ghArgumentsOf(action, request.labelLook)) {
    try {
      await runGh(args);
    } catch (e) {
      return { level: "error", msg: "flag issue: gh failed", fields: { file: flag.file, command: args.slice(0, 2).join(" "), reason: messageOf(e) } };
    }
  }
  return { level: "info", msg: "flag issue filed", fields: { file: flag.file, title: flag.title } };
}

/** Far above a list at its bound, so a list file larger is not one. */
const LIST_FILE_LIMIT_BYTES = 262_144;

/** The list the watch's CLI wrote, or why it was refused: never a link, never larger or longer than a list can be. */
function readList(path: string): NewFlag[] | string {
  const text = readBoundedFile(path, LIST_FILE_LIMIT_BYTES);
  if (text.kind === "refused") return text.reason;
  let list: unknown;
  try {
    list = JSON.parse(text.text);
  } catch {
    return `${path} is not JSON`;
  }
  if (!Array.isArray(list)) return `${path} is not a list`;
  if (list.length > NEW_FLAGS_LIMIT) return `${path} lists ${list.length} flags, more than the ${NEW_FLAGS_LIMIT} a list may hold`;
  if (!list.every(isNewFlag)) return `${path} lists something that is not a flag the watch writes`;
  return list.map(({ file, title }) => ({ file, title }));
}

/** A flag file's name: markdown, directly in the flags folder, so a list cannot point anywhere else. */
const FLAG_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

function isNewFlag(value: unknown): value is NewFlag {
  if (typeof value !== "object" || value === null) return false;
  const { file, title } = value as Record<string, unknown>;
  return typeof file === "string" && FLAG_FILE_NAME.test(file)
    && typeof title === "string" && title !== "" && !/[\r\n]/.test(title);
}

/** The request, or why the command line was refused. */
function readRequest(argv: readonly string[]): FilingRequest | string {
  const given = readArguments(argv, ARGUMENTS);
  if (typeof given === "string") return given;
  const value = (name: string) => given.get(name)!;
  return {
    list: value("--list"), flagsDir: value("--flags-dir"), label: value("--label"),
    labelLook: { color: value("--label-color"), description: value("--label-description") },
  };
}
