import { lstatSync, readFileSync } from "node:fs";
import type { GhRunner } from "./gh.js";
import {
  actionOnKeptIssue, ghArgumentsOf, ghListArgumentsOf, type KeptIssue, type LabelLook, type RunFinding,
} from "./kept-issue.js";
import type { LogEvent } from "./print.js";

/**
 * The kept-issue CLI as a function (#117 decision 12): it reads the tracker
 * through `runGh`, decides through `actionOnKeptIssue`, and hands `runGh` the
 * argument lists `ghArgumentsOf` gives, in order, stopping at the first that
 * fails. `cli-kept-issue.ts` gives it the real `gh`; the arguments are written
 * there.
 */

/** What one run of the kept-issue CLI did: the lines it logs and the code it exits with. */
export interface KeepIssueRun { events: LogEvent[]; exitCode: 0 | 1 }

/** What the command line asks: the issue, its label's look, and the run's finding. */
interface KeepRequest { issue: KeptIssue; labelLook: LabelLook; finding: RunFinding }

const FLAGS = ["--title", "--label", "--label-color", "--label-description", "--finding", "--body", "--closing", "--finding-file"];

/** Above any body the tracker takes (65,536 characters), so a finding file larger is not one. */
const FINDING_FILE_LIMIT_BYTES = 262_144;

const failedRun = (msg: string, fields: Record<string, unknown>): KeepIssueRun =>
  ({ events: [{ level: "error", msg, fields }], exitCode: 1 });

export async function keepIssue(argv: readonly string[], runGh: GhRunner): Promise<KeepIssueRun> {
  const request = readRequest(argv);
  if (typeof request === "string") return failedRun("kept issue: the arguments were refused", { reason: request });
  const { issue, labelLook, finding } = request;
  let listed: string;
  try {
    listed = await runGh(ghListArgumentsOf(issue));
  } catch (e) {
    return failedRun("kept issue: the tracker could not be read", { title: issue.title, reason: messageOf(e) });
  }
  const action = actionOnKeptIssue(issue, finding, listed);
  if (action.kind === "unread") return failedRun("kept issue: the tracker could not be read", { title: issue.title, reason: action.reason });
  for (const args of ghArgumentsOf(action, labelLook)) {
    try {
      await runGh(args);
    } catch (e) {
      return failedRun("kept issue: gh failed", { title: issue.title, action: action.kind, command: args.slice(0, 2).join(" "), reason: messageOf(e) });
    }
  }
  const number = "number" in action ? action.number : undefined;
  return { events: [{ level: "info", msg: "kept issue", fields: { title: issue.title, action: action.kind, number } }], exitCode: 0 };
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The request, or why the command line was refused. */
function readRequest(argv: readonly string[]): KeepRequest | string {
  const given = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!FLAGS.includes(flag)) return `${flag} is not an argument this CLI takes`;
    if (value === undefined) return `${flag} has no value`;
    given.set(flag, value);
  }
  const [title, label, color, description] = ["--title", "--label", "--label-color", "--label-description"].map((f) => given.get(f));
  if (!title || !label || !color || !description) return "--title, --label, --label-color and --label-description are each needed";
  const finding = given.has("--finding-file") ? readFindingFile(given.get("--finding-file")!) : findingOfFlags(given);
  if (typeof finding === "string") return finding;
  return { issue: { title, label }, labelLook: { color, description }, finding };
}

/** `--finding red --body <text>`, `--finding green --closing <text>` or `--finding unsaid`. */
function findingOfFlags(given: ReadonlyMap<string, string>): RunFinding | string {
  const finding = { kind: given.get("--finding"), body: given.get("--body"), closing: given.get("--closing") };
  return isRunFinding(finding) ? pickFinding(finding) : "the finding is red with a --body, green with a --closing, or unsaid";
}

/** A JSON `RunFinding`, written by the run before this step; never a link, never larger than a body can be. */
function readFindingFile(path: string): RunFinding | string {
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return `${path} is not a file`;
    if (stat.size > FINDING_FILE_LIMIT_BYTES) return `${path} is larger than a finding can be`;
    text = readFileSync(path, "utf8");
  } catch (e) {
    return `${path} could not be read: ${messageOf(e)}`;
  }
  let finding: unknown;
  try {
    finding = JSON.parse(text);
  } catch {
    return `${path} is not JSON`;
  }
  return isRunFinding(finding) ? pickFinding(finding) : `${path} does not hold a finding`;
}

function isRunFinding(value: unknown): value is RunFinding {
  if (typeof value !== "object" || value === null) return false;
  const { kind, body, closing } = value as Record<string, unknown>;
  if (kind === "red") return typeof body === "string" && body !== "";
  if (kind === "green") return typeof closing === "string" && closing !== "";
  return kind === "unsaid";
}

/** The finding alone, without the fields its kind does not carry. */
function pickFinding(finding: RunFinding): RunFinding {
  if (finding.kind === "red") return { kind: "red", body: finding.body };
  if (finding.kind === "green") return { kind: "green", closing: finding.closing };
  return { kind: "unsaid" };
}
