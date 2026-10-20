/**
 * What a finished watch run says (#54): its flags, its log lines and its exit
 * code, returned as data, and the choices the run makes on the way there.
 *
 * `cli-watch.ts` reads the files, runs the watch, writes what this module
 * returns and exits. Every branch that decides what a run says is here, where
 * a test can call it; the CLI holds only I/O.
 */
import {
  mergeTargetedRun, runSummary, STRATEGIES, unreadNotices,
  type FetchResult, type Outcome, type RunVerdict, type UnreadNotice, type WatchEntry, type WatchReport, type WatchState,
  type Watchlist,
} from "./core.js";
import { makePrintable } from "./failure.js";
import { readableAddressOf } from "./trust-line.js";

export type LogLevel = "info" | "warn" | "error";

/** One log line before it is printed: the CLI stamps `ts` on it. */
export interface LogEvent {
  level: LogLevel;
  msg: string;
  fields: Record<string, unknown>;
}

/** One flag file: its name under `watch/flags/` and its whole text. */
export interface FlagDocument {
  name: string;
  body: string;
}

/** A finished run: its reports and verdict, its day, and what became of its state. */
export interface FinishedRun {
  reports: WatchReport[];
  verdict: RunVerdict;
  today: string;
  state: StateOutcome;
}

/**
 * What a finished run says: the flags it files, the lines it logs around
 * writing them, the code it exits with.
 *
 * The lines come in two groups, printed on either side of the writes, so a
 * run whose flags or state cannot be written has still printed what it read.
 */
export interface RunSays {
  flags: FlagDocument[];
  /** Each report's line, then each unread notice. */
  beforeWrites: LogEvent[];
  /** What became of the state, then `watch complete`. */
  afterWrites: LogEvent[];
  exitCode: 0 | 1;
}

export function sayRun(run: FinishedRun): RunSays {
  const { reports, verdict, today } = run;
  return {
    flags: reports
      .filter((r) => r.outcome === "changed" || r.outcome === "reminder-due")
      .map((r) => flagOf(r, today)),
    beforeWrites: [...reports.map(reportEvent), ...unreadNotices(verdict, today).map(noticeEvent)],
    afterWrites: [stateEvent(run.state), completeEvent(reports, verdict)],
    exitCode: verdict.red ? 1 : 0,
  };
}

/**
 * What a curator does about this flag. The advice per strategy lives in one
 * table in core.ts, so a `pdf-text` entry whose WORDS moved is told what to do
 * with a PDF and not with a web page. What a sentinel means is the exception,
 * because it is about the entry's kind and not about how it is read.
 */
function remediation(report: WatchReport): string {
  if (report.kind === "sentinel" && report.outcome !== "reminder-due") return SENTINEL_REMEDIATION;
  return STRATEGIES[report.strategy].remediation;
}

/** What a curator does about a sentinel that changed. */
export const SENTINEL_REMEDIATION =
  "Sentinel changed — it backs no dataset value directly. Read the source, act on the intent below, and extend the watchlist if new value pages appeared.";

/** Our line directly above the excerpt's fence. */
export const EXCERPT_INTRODUCTION = "The page now reads, around the first difference (cut where the page goes on):";

/**
 * The header is one block with no blank line inside it: the committed-flags
 * test, and a curator's resolution appended below, read it as everything up
 * to the first blank line. Every section after it stands apart by one, so our
 * advice never renders as part of the page's words.
 */
function flagOf(report: WatchReport, today: string): FlagDocument {
  const header = [
    `# Watch flag: ${report.id} — ${report.outcome}`,
    `- url: ${readableAddressOf(report.url)}`,
    `- kind: ${report.kind}`,
    `- date: ${today}`,
    report.old_hash ? `- old: ${report.old_hash}` : "",
    report.new_hash ? `- new: ${report.new_hash}` : "",
  ].filter(Boolean).join("\n");
  const sections = [
    header,
    report.note ? `Intent: ${report.note}` : "",
    report.excerpt === undefined ? "" : excerptSection(report.excerpt),
    remediation(report),
  ].filter(Boolean);
  // Reminders use a stable name (self-overwriting, no daily pile-up);
  // content changes keep the date so history stays visible.
  const name = report.outcome === "reminder-due" ? `${report.id}-reminder.md` : `${report.id}-${today}.md`;
  return { name, body: sections.join("\n\n") + "\n" };
}

/**
 * The page's words in a fenced block, so nothing in them acts on the issue
 * they are shown in: no mention, link, image or emphasis. The fence is one
 * backtick longer than the longest run in the words, so the page cannot close
 * it, and the words are one line because the printable rule collapses every
 * newline.
 */
function excerptSection(excerpt: string): string {
  const words = makePrintable(excerpt);
  if (!words) return "The page's words around the first difference print nothing; read the page.";
  const fence = "`".repeat(Math.max(3, longestBacktickRun(words) + 1));
  return [EXCERPT_INTRODUCTION, `${fence}text`, words, fence].join("\n");
}

/** Bounded by the cut: an excerpt is at most 180 characters. */
function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}

/** How loudly each outcome is logged: a source not read is an error, news is a warning. */
const LEVEL_OF: Record<Outcome, LogLevel> = {
  unreachable: "error",
  unchanged: "info",
  ok: "info",
  changed: "warn",
  baseline: "warn",
  "reminder-due": "warn",
};

function reportEvent(r: WatchReport): LogEvent {
  return {
    level: LEVEL_OF[r.outcome],
    msg: `watch:${r.outcome}`,
    fields: {
      id: r.id, url: readableAddressOf(r.url), old: r.old_hash, new: r.new_hash, error: r.error,
      // Which kind of failure it was, so a morning's log says why the run is
      // the colour it is without anybody reading the error back.
      failure: r.failure,
    },
  };
}

/**
 * What each unread source is, in one line each: a lapse warned about, an
 * outage and a refusal shouted about.
 *
 * The words and the loudness are the run's, decided in `core.ts` beside the
 * rule that colours the day — so the one place that knows a source has been
 * silent twice inside the week is the one place that says so, and this module
 * passes on what it is handed. An outage's line carries the mornings it was
 * counted from, so a curator reads the days rather than the word alone.
 */
function noticeEvent(notice: UnreadNotice): LogEvent {
  return {
    level: notice.level,
    msg: `watch:${notice.event}`,
    fields: { id: notice.id, url: readableAddressOf(notice.url), days: notice.days, today: notice.today },
  };
}

function stateEvent(state: StateOutcome): LogEvent {
  if (state.kind === "committed") {
    return {
      level: "info",
      msg: "state committed",
      fields: { entries: state.entries, only: state.only ?? null, last_run: state.last_run },
    };
  }
  return { level: "info", msg: "dry run — state untouched (use --commit to persist)", fields: {} };
}

/**
 * The run's last line, and the exit code: the one signal the workflow reads.
 *
 * `lapsed` and `outages` sit beside `unreachable` so that a green day on
 * which a source still went unread is visible in the log and not only in
 * `watch/state.json`; `refused` is there so the three add up to
 * `unreachable` rather than leaving a reader to guess where the rest went.
 *
 * The exit code is the verdict's, not a count of failures: a source that has
 * been silent for one morning is a lapse and the run stays green, while an
 * outage — two mornings running — and anything the watch refused to request
 * are red the same day. `.github/workflows/watch.yml` keys on the step's
 * outcome and counts nothing itself (s35 point 5).
 */
function completeEvent(reports: WatchReport[], verdict: RunVerdict): LogEvent {
  return { level: verdict.red ? "error" : "info", msg: "watch complete", fields: { ...runSummary(reports, verdict) } };
}

/** What the command line asks of a run. */
export interface RunArgs {
  /** `--only=<id>`: the one entry to run, the rule at `chooseEntries`. */
  only?: string;
  /** `--commit` writes the state; without it the run is a dry run. */
  persist: "commit" | "dry-run";
}

export function readRunArgs(argv: readonly string[]): RunArgs {
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  return {
    only: onlyArg?.slice("--only=".length),
    persist: argv.includes("--commit") ? "commit" : "dry-run",
  };
}

/** The entries a run reads, or the answer to an id the watchlist does not hold. */
export type EntryChoice =
  | { kind: "run"; watchlist: Watchlist }
  | { kind: "no-such-entry"; event: LogEvent; exitCode: 2 };

/**
 * `--only=<id>` runs one entry and leaves every other snapshot untouched.
 *
 * A curator who moves a slice marker on purpose has to re-baseline that entry
 * and only that entry: running all thirty would rewrite thirty snapshots and
 * bury the one deliberate change among them. The daily run passes no filter
 * and is unaffected.
 */
export function chooseEntries(watchlist: Watchlist, only: string | undefined): EntryChoice {
  if (!only) return { kind: "run", watchlist };
  const wanted = watchlist.entries.filter((e) => e.id === only);
  if (!wanted.length) {
    return { kind: "no-such-entry", event: { level: "error", msg: "no such watch entry", fields: { id: only } }, exitCode: 2 };
  }
  return { kind: "run", watchlist: { ...watchlist, entries: wanted } };
}

/** What became of the state at the end of a run. */
export type StateOutcome =
  | { kind: "committed"; entries: number; only?: string; last_run?: string }
  | { kind: "dry-run" };

/** A finished pass, and what the command line asked to do with its state. */
export interface PassToSettle {
  args: RunArgs;
  previous: WatchState;
  pass: WatchState;
  /** The entries the pass read: the whole watchlist, or the one `--only` named. */
  fetched: Watchlist;
  today: string;
}

/** What becomes of the state: the outcome the run reports, and the file's text when it is written. */
export interface SettledState {
  outcome: StateOutcome;
  text: string | null;
}

export function settleState(settle: PassToSettle): SettledState {
  if (settle.args.persist === "dry-run") return { outcome: { kind: "dry-run" }, text: null };
  // With `--only`, every other entry's snapshot is carried over untouched: a
  // targeted re-baseline must not quietly drop the twenty-nine it did not
  // fetch, and it must not stamp the day every source was last re-read. What
  // it may say something about is the one entry it did fetch. The rule is
  // `mergeTargetedRun`, beside the code that writes a full run's state.
  const merged = settle.args.only
    ? mergeTargetedRun(settle.previous, settle.pass, settle.fetched, settle.today)
    : settle.pass;
  return {
    outcome: { kind: "committed", entries: Object.keys(merged.entries).length, only: settle.args.only, last_run: merged.last_run },
    text: JSON.stringify(merged, null, 2) + "\n",
  };
}

/**
 * Where the reading was actually taken, when that is not where it was asked
 * for — on either tier, by the same rule.
 *
 * Another ORIGIN is refused outright by both readers. This is the journey
 * inside one: a redirect the fetcher followed, a form that posts back to a
 * sub-path, a script that swaps the document. It is allowed, and a curator
 * should be able to see it without opening a browser — which is what the
 * comment on `from` in `core.ts` promises.
 */
export function sayWhereItRead(entry: Pick<WatchEntry, "id" | "url">, result: FetchResult): LogEvent | undefined {
  const readAt = addressReadElsewhere(entry, result);
  if (!readAt) return undefined;
  return { level: "info", msg: "watch:read_at", fields: { id: entry.id, asked: readableAddressOf(entry.url), read_at: readAt } };
}

/** The address an ok reading was taken at, when it is not the one asked for. */
function addressReadElsewhere(entry: { url: string }, result: FetchResult): string | undefined {
  if (!result.ok || result.from === entry.url) return undefined;
  return result.from || undefined;
}

/** Windows editors love BOMs; a hand-edited watchlist/state must not crash the watch. */
export function parseJsonText(text: string): unknown {
  return JSON.parse(text.replace(/^﻿/, ""));
}
