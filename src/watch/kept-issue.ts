/**
 * A kept issue (#117): one issue a run opens, comments on, reopens and closes
 * by itself, because what it says is the run's own state. One table decides
 * every kept issue: what the run found × the issue's state → the action. The
 * issue's words (title, label, body) stay with the run that keeps it.
 */

/** What the run found, in the issue's terms. */
export type RunFinding =
  | { kind: "red"; body: string }
  | { kind: "green"; closing: string }
  | { kind: "unsaid" };

/** The issue a run keeps, as written in its workflow. */
export interface KeptIssue { title: string; label: string }

export type KeptIssueAction =
  | { kind: "create"; title: string; label: string; body: string }
  | { kind: "comment"; number: number; reopen: boolean; body: string }
  | { kind: "close"; number: number; comment: string }
  | { kind: "nothing" }
  | { kind: "unread"; reason: string };

/**
 * The most issues one read of the tracker asks for. An answer this long may
 * have left the issue past its end, so it is a tracker not read.
 */
export const TRACKER_READ_LIMIT = 100;

/** One issue as the tracker lists it. */
interface ListedIssue { number: number; state: "OPEN" | "CLOSED"; title: string }

/**
 * `listed` is the tracker's answer as text (number, state and title of each
 * issue under the label). The issue is found by its exact title, open or
 * closed; an open one speaks for the title when a closed one shares it.
 */
export function actionOnKeptIssue(issue: KeptIssue, finding: RunFinding, listed: string): KeptIssueAction {
  const read = readListed(listed);
  if (read.kind === "unread") return read;
  const named = read.issues.filter((l) => l.title === issue.title);
  const found = named.find((l) => l.state === "OPEN") ?? named[0];
  if (finding.kind === "red") {
    if (!found) return { kind: "create", title: issue.title, label: issue.label, body: finding.body };
    return { kind: "comment", number: found.number, reopen: found.state === "CLOSED", body: finding.body };
  }
  if (finding.kind === "green" && found?.state === "OPEN") return { kind: "close", number: found.number, comment: finding.closing };
  return { kind: "nothing" };
}

type ListedRead = { kind: "read"; issues: ListedIssue[] } | { kind: "unread"; reason: string };

const isListedIssue = (l: unknown): l is ListedIssue => {
  if (typeof l !== "object" || l === null) return false;
  const { number, state, title } = l as Record<string, unknown>;
  return Number.isInteger(number) && (state === "OPEN" || state === "CLOSED") && typeof title === "string";
};

function readListed(listed: string): ListedRead {
  let issues: unknown;
  try {
    issues = JSON.parse(listed);
  } catch {
    return { kind: "unread", reason: "the tracker's answer is not JSON" };
  }
  if (!Array.isArray(issues)) return { kind: "unread", reason: "the tracker's answer is not a list" };
  if (issues.length >= TRACKER_READ_LIMIT) {
    return { kind: "unread", reason: `the tracker listed ${issues.length} issues, the read's limit, so the issue may be past it` };
  }
  if (!issues.every(isListedIssue)) return { kind: "unread", reason: "an issue in the tracker's answer has no number, title or known state" };
  return { kind: "read", issues };
}
