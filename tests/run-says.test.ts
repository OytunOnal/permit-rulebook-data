import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { describe, expect, it } from "vitest";
import { STRATEGIES, type RunVerdict, type WatchEntry, type WatchReport, type WatchState } from "../src/watch/core.js";
import {
  chooseEntries, EXCERPT_INTRODUCTION, parseJsonText, readRunArgs, sayRun, sayWhereItRead, SENTINEL_REMEDIATION, settleState,
  type StateOutcome,
} from "../src/watch/run-says.js";

/**
 * What a finished watch run says (#54): its flags, its log lines and its exit
 * code, reached through the module the CLI writes from. A flag's excerpt is
 * the page's (#14): fenced, so nothing in it acts on the issue it is shown in.
 */

const OLD = "2d6e50243e606ab0c8f3784a88fedd27ca038ca25daa236a5865b5118a11b10a";
const NEW = "f81cdc992a27dfdbbd428b277139b5c4dbf3f5de139013500b6f8c7947f808a5";
const TODAY = "2026-10-18";
const GREEN: RunVerdict = { lapsed: [], outages: [], refused: [], red: false };
const DRY: StateOutcome = { kind: "dry-run" };

const report = (r: Partial<WatchReport> & Pick<WatchReport, "id" | "outcome">): WatchReport =>
  ({ url: `https://example.org/${r.id}`, strategy: "html", kind: "value-source", ...r }) as WatchReport;

const htmlChange = report({
  id: "nl-ind-blue-card", url: "https://ind.nl/en/blue-card", outcome: "changed",
  note: "Backs the salary threshold.", old_hash: OLD, new_hash: NEW,
  excerpt: "the gross monthly salary is at least EUR 5,688",
});
const sentinelChange = report({
  id: "buzer-index", url: "https://www.buzer.de/index.htm", kind: "sentinel", outcome: "changed",
  note: "An edition index.", old_hash: OLD, new_hash: NEW,
});
const sentinelReminder = report({
  id: "gesetze-official-recheck", url: "https://www.gesetze-im-internet.de/aufenthg_2004/anlage.html",
  strategy: "human", kind: "sentinel", outcome: "reminder-due", note: "Re-read the annex by hand.",
});
const pdfTextChange = report({ id: "fr-decree", strategy: "pdf-text", outcome: "changed", old_hash: OLD, new_hash: NEW });
const pdfChange = report({ id: "p", strategy: "pdf", outcome: "changed", old_hash: OLD, new_hash: NEW });
const unreachable = report({ id: "c", outcome: "unreachable", error: "HTTP 503", failure: "transient" });

/** The header block of every flag on `nl-ind-blue-card`, changed on TODAY. */
const BLUE_CARD_HEADER = [
  "# Watch flag: nl-ind-blue-card — changed",
  "- url: https://ind.nl/en/blue-card",
  "- kind: value-source",
  "- date: 2026-10-18",
  `- old: ${OLD}`,
  `- new: ${NEW}`,
];

const flagsOf = (...reports: WatchReport[]) =>
  sayRun({ reports, verdict: GREEN, today: TODAY, state: DRY }).flags;

describe("sayRun — the flags a run files, in today's format", () => {
  it("writes a change under its dated name, header first, then the intent, the excerpt and the remediation", () => {
    expect(flagsOf(htmlChange)).toEqual([{
      name: "nl-ind-blue-card-2026-10-18.md",
      body: [
        ...BLUE_CARD_HEADER,
        "",
        "Intent: Backs the salary threshold.",
        "",
        "The page now reads, around the first difference (cut where the page goes on):",
        "```text",
        "the gross monthly salary is at least EUR 5,688",
        "```",
        "",
        "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
        "",
      ].join("\n"),
    }]);
  });

  it("writes a due reminder under its stable name, with no hashes", () => {
    expect(flagsOf(sentinelReminder)).toEqual([{
      name: "gesetze-official-recheck-reminder.md",
      body: [
        "# Watch flag: gesetze-official-recheck — reminder-due",
        "- url: https://www.gesetze-im-internet.de/aufenthg_2004/anlage.html",
        "- kind: sentinel",
        "- date: 2026-10-18",
        "",
        "Intent: Re-read the annex by hand.",
        "",
        "Scheduled human re-verification is due. After verifying, update `last_verified` for this entry in watch/watchlist.json.",
        "",
      ].join("\n"),
    }]);
  });

  it("files nothing for unchanged, ok, unreachable or baseline", () => {
    expect(flagsOf(
      report({ id: "a", outcome: "unchanged", old_hash: OLD, new_hash: OLD }),
      report({ id: "b", outcome: "ok" }),
      unreachable,
      report({ id: "d", outcome: "baseline", new_hash: NEW }),
    )).toEqual([]);
  });

  it("files one flag per change or reminder, in the reports' order", () => {
    expect(flagsOf(htmlChange, report({ id: "b", outcome: "ok" }), sentinelReminder).map((f) => f.name))
      .toEqual(["nl-ind-blue-card-2026-10-18.md", "gesetze-official-recheck-reminder.md"]);
  });
});

/** The flag as GitHub would draw it: GFM, with raw HTML passed through as an issue body passes it. */
const render = (markdown: string) =>
  micromark(markdown, { allowDangerousHtml: true, extensions: [gfm()], htmlExtensions: [gfmHtml()] });
const CODE_BLOCK = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g;
const textOf = (html: string) =>
  html.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
/** The text of each paragraph the renderer drew outside every code block. */
const paragraphsOutside = (html: string) =>
  [...html.replace(CODE_BLOCK, "").matchAll(/<p>([\s\S]*?)<\/p>/g)].map((match) => textOf(match[1]!));
/** Our sentences around an html entry's excerpt. */
const OURS = [EXCERPT_INTRODUCTION, STRATEGIES.html.remediation];

describe("sayRun — the flag's excerpt is the page's", () => {
  const hostile = report({
    id: "nl-ind-blue-card", url: "https://ind.nl/en/blue-card", outcome: "changed",
    note: "Backs the salary threshold.", old_hash: OLD, new_hash: NEW,
    excerpt: "ask @login about #12, see [x](y) <img src=x> and ``` then \u202Eesrever\u001b[31m red 😀 end",
  });

  it("fences a hostile excerpt so the renderer acts on none of it", () => {
    const html = render(flagsOf(hostile)[0]!.body);
    const blocks = [...html.matchAll(CODE_BLOCK)];
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0]![1]!)).toBe("ask @login about #12, see [x](y) <img src=x> and ``` then esrever [31m red 😀 end\n");
    const outside = html.replace(CODE_BLOCK, "");
    for (const word of ["@login", "#12", "[x](y)", "img", "```", "esrever"]) expect(outside).not.toContain(word);
    // The one link in the flag is our url line; the page's words make none, and no image.
    expect(html.match(/<a\b[^>]*>/g)).toEqual(['<a href="https://ind.nl/en/blue-card">']);
    expect(html).not.toMatch(/<img\b/);
    expect(paragraphsOutside(html)).toEqual(expect.arrayContaining(OURS));
  });

  it("writes the page's words inside the fence as the page wrote them, less what steers", () => {
    expect(flagsOf(hostile)[0]!.body).toBe([
      ...BLUE_CARD_HEADER,
      "",
      "Intent: Backs the salary threshold.",
      "",
      "The page now reads, around the first difference (cut where the page goes on):",
      "````text",
      "ask @login about #12, see [x](y) <img src=x> and ``` then esrever [31m red 😀 end",
      "````",
      "",
      "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
      "",
    ].join("\n"));
  });

  it("a run of four backticks in the excerpt cannot close its fence", () => {
    const html = render(flagsOf({ ...hostile, excerpt: "before ```` after" })[0]!.body);
    const blocks = [...html.matchAll(CODE_BLOCK)];
    expect(blocks).toHaveLength(1);
    expect(textOf(blocks[0]![1]!)).toBe("before ```` after\n");
    expect(paragraphsOutside(html)).toEqual(expect.arrayContaining(OURS));
  });

  it("gives an excerpt that prints nothing the print-nothing line and no fence", () => {
    expect(flagsOf({ ...hostile, excerpt: "\u202E\u200B\u2066" })[0]!.body).toBe([
      ...BLUE_CARD_HEADER,
      "",
      "Intent: Backs the salary threshold.",
      "",
      "The page's words around the first difference print nothing; read the page.",
      "",
      "Update the dataset value(s) with quote + retrieval date; move the old value into history.",
      "",
    ].join("\n"));
  });

  it("writes neither the line nor the fence for a report with no excerpt", () => {
    expect(flagsOf(pdfChange)[0]!.body).toBe([
      "# Watch flag: p — changed",
      "- url: https://example.org/p",
      "- kind: value-source",
      "- date: 2026-10-18",
      `- old: ${OLD}`,
      `- new: ${NEW}`,
      "",
      "PDF changed — a human must read it; no value is extracted automatically.",
      "",
    ].join("\n"));
  });

  it("keeps the header one block, up to the first blank line, with the url, the date and the hashes", () => {
    const body = flagsOf(hostile)[0]!.body;
    expect(body.slice(0, body.indexOf("\n\n"))).toBe(BLUE_CARD_HEADER.join("\n"));
  });
});

describe("sayRun — the remediation a flag ends on", () => {
  const lastLine = (r: WatchReport) => flagsOf(r)[0]!.body.trimEnd().split("\n").at(-1);

  it("gives a sentinel's change the sentinel sentence", () => {
    expect(lastLine(sentinelChange)).toBe(SENTINEL_REMEDIATION);
  });

  it("gives a sentinel's due reminder its strategy's sentence", () => {
    expect(lastLine(sentinelReminder)).toBe(STRATEGIES.human.remediation);
  });

  it("gives every other report its strategy's sentence", () => {
    expect(lastLine(pdfTextChange)).toBe(STRATEGIES["pdf-text"].remediation);
    expect(lastLine(pdfChange)).toBe(STRATEGIES.pdf.remediation);
    expect(lastLine(report({ id: "l", strategy: "human", outcome: "reminder-due" }))).toBe(STRATEGIES.human.remediation);
  });
});

describe("sayRun — what the run logs, and the code it exits with", () => {
  it("logs each report at its outcome's level", () => {
    const outcomes = ["unreachable", "unchanged", "ok", "changed", "baseline", "reminder-due"] as const;
    const reports = outcomes.map((outcome) => outcome === "unreachable" ? unreachable : report({ id: outcome, outcome }));
    const { beforeWrites } = sayRun({ reports, verdict: GREEN, today: TODAY, state: DRY });
    expect(beforeWrites.map((e) => [e.msg, e.level])).toEqual([
      ["watch:unreachable", "error"],
      ["watch:unchanged", "info"],
      ["watch:ok", "info"],
      ["watch:changed", "warn"],
      ["watch:baseline", "warn"],
      ["watch:reminder-due", "warn"],
    ]);
  });

  it("carries the report's address, hashes, error and failure class on its line", () => {
    const { beforeWrites } = sayRun({ reports: [unreachable], verdict: GREEN, today: TODAY, state: DRY });
    expect(beforeWrites[0]).toEqual({
      level: "error", msg: "watch:unreachable",
      fields: { id: "c", url: "https://example.org/c", error: "HTTP 503", failure: "transient" },
    });
    const changed = sayRun({ reports: [htmlChange], verdict: GREEN, today: TODAY, state: DRY }).beforeWrites[0];
    expect(changed).toEqual({
      level: "warn", msg: "watch:changed",
      fields: { id: "nl-ind-blue-card", url: "https://ind.nl/en/blue-card", old: OLD, new: NEW },
    });
  });

  it("passes each unread notice through at its own level, after the reports", () => {
    const verdict: RunVerdict = {
      lapsed: [{ id: "es-boe", url: "https://www.boe.es/a", days: ["2026-10-18"] }],
      outages: [{ id: "fr-anef", url: "https://anef.example/b", days: ["2026-10-15", "2026-10-18"] }],
      refused: [{ id: "local", url: "http://10.0.0.5/c", days: ["2026-10-18"] }],
      red: true,
    };
    const { beforeWrites } = sayRun({ reports: [], verdict, today: TODAY, state: DRY });
    expect(beforeWrites).toEqual([
      { level: "warn", msg: "watch:lapse", fields: { id: "es-boe", url: "https://www.boe.es/a", days: ["2026-10-18"], today: TODAY } },
      { level: "error", msg: "watch:outage", fields: { id: "fr-anef", url: "https://anef.example/b", days: ["2026-10-15", "2026-10-18"], today: TODAY } },
      { level: "error", msg: "watch:refused", fields: { id: "local", url: "http://10.0.0.5/c", days: ["2026-10-18"], today: TODAY } },
    ]);
  });

  it("says the state was committed, with its count, its targeted id and its last run", () => {
    const say = (state: StateOutcome) => sayRun({ reports: [], verdict: GREEN, today: TODAY, state }).afterWrites[0];
    expect(say({ kind: "committed", entries: 30, only: "nl-ind-blue-card", last_run: "2026-10-16" })).toEqual({
      level: "info", msg: "state committed", fields: { entries: 30, only: "nl-ind-blue-card", last_run: "2026-10-16" },
    });
    expect(say({ kind: "committed", entries: 30, last_run: TODAY })).toEqual({
      level: "info", msg: "state committed", fields: { entries: 30, only: null, last_run: TODAY },
    });
  });

  it("says a dry run left the state untouched", () => {
    expect(sayRun({ reports: [], verdict: GREEN, today: TODAY, state: DRY }).afterWrites[0]).toEqual({
      level: "info", msg: "dry run — state untouched (use --commit to persist)", fields: {},
    });
  });

  it("ends on watch complete with the run summary, and a green run exits 0", () => {
    const reports = [htmlChange, report({ id: "b", outcome: "ok" }), unreachable];
    const verdict: RunVerdict = { ...GREEN, lapsed: [{ id: "c", url: "https://example.org/c", days: [TODAY] }] };
    const says = sayRun({ reports, verdict, today: TODAY, state: DRY });
    expect(says.afterWrites.at(-1)).toEqual({
      level: "info", msg: "watch complete",
      fields: { total: 3, changed: 1, unreachable: 1, lapsed: 1, outages: 0, refused: 0 },
    });
    expect(says.exitCode).toBe(0);
  });

  it("ends a red run on an error-level watch complete, and exits 1", () => {
    const reports = [unreachable];
    const verdict: RunVerdict = { ...GREEN, outages: [{ id: "c", url: "https://example.org/c", days: ["2026-10-15", TODAY] }], red: true };
    const says = sayRun({ reports, verdict, today: TODAY, state: DRY });
    expect(says.afterWrites.at(-1)).toEqual({
      level: "error", msg: "watch complete",
      fields: { total: 1, changed: 0, unreachable: 1, lapsed: 0, outages: 1, refused: 0 },
    });
    expect(says.exitCode).toBe(1);
  });

  it("says what it read before the flags and the state are written, and what became of them after", () => {
    const verdict: RunVerdict = { ...GREEN, lapsed: [{ id: "c", url: "https://example.org/c", days: [TODAY] }] };
    const reports = [htmlChange, unreachable];
    const { beforeWrites, afterWrites } = sayRun({ reports, verdict, today: TODAY, state: DRY });
    expect(beforeWrites.map((e) => e.msg)).toEqual(["watch:changed", "watch:unreachable", "watch:lapse"]);
    expect(afterWrites.map((e) => e.msg)).toEqual(["dry run — state untouched (use --commit to persist)", "watch complete"]);
  });
});

const entry = (id: string): WatchEntry =>
  ({ id, url: `https://example.org/${id}`, strategy: "html", kind: "value-source" });

describe("readRunArgs — what the command line asks", () => {
  it("reads the one entry and the commit", () => {
    expect(readRunArgs(["node", "cli-watch.js", "--only=nl-ind-blue-card", "--commit"]))
      .toEqual({ only: "nl-ind-blue-card", persist: "commit" });
  });

  it("is a dry run over every entry when given nothing", () => {
    expect(readRunArgs(["node", "cli-watch.js"])).toEqual({ only: undefined, persist: "dry-run" });
  });
});

describe("chooseEntries — the --only choice", () => {
  const watchlist = { entries: [entry("a"), entry("b"), entry("c")] };

  it("answers an unknown id with \"no such watch entry\" and exit 2", () => {
    expect(chooseEntries(watchlist, "nope")).toEqual({
      kind: "no-such-entry",
      event: { level: "error", msg: "no such watch entry", fields: { id: "nope" } },
      exitCode: 2,
    });
  });

  it("runs a known id's entry alone", () => {
    expect(chooseEntries(watchlist, "b")).toEqual({ kind: "run", watchlist: { entries: [entry("b")] } });
  });

  it("runs every entry when no id is given", () => {
    expect(chooseEntries(watchlist, undefined)).toEqual({ kind: "run", watchlist });
    expect(chooseEntries(watchlist, "")).toEqual({ kind: "run", watchlist });
  });
});

describe("settleState — what becomes of the state", () => {
  const snapshot = (hash: string) => ({ hash, retrieved_at: "2026-10-01", history: [] });
  const previous: WatchState = { entries: { a: snapshot("1"), b: snapshot("2") }, last_run: "2026-10-16" };
  const pass: WatchState = { entries: { b: snapshot("3") }, last_run: "2026-10-18", unread: [] };
  const fetched = { entries: [entry("b")] };

  it("writes nothing on a dry run", () => {
    expect(settleState({ args: { persist: "dry-run" }, previous, pass, fetched, today: "2026-10-18" }))
      .toEqual({ outcome: { kind: "dry-run" }, text: null });
  });

  it("writes a full run's state as the pass left it", () => {
    const settled = settleState({ args: { persist: "commit" }, previous, pass, fetched, today: "2026-10-18" });
    expect(settled.outcome).toEqual({ kind: "committed", entries: 1, only: undefined, last_run: "2026-10-18" });
    expect(settled.text).toBe([
      "{",
      '  "entries": {',
      '    "b": {',
      '      "hash": "3",',
      '      "retrieved_at": "2026-10-01",',
      '      "history": []',
      "    }",
      "  },",
      '  "last_run": "2026-10-18",',
      '  "unread": []',
      "}",
      "",
    ].join("\n"));
  });

  it("carries every other entry over on a targeted run, and keeps the last full run's day", () => {
    const settled = settleState({ args: { persist: "commit", only: "b" }, previous, pass, fetched, today: "2026-10-18" });
    expect(settled.outcome).toEqual({ kind: "committed", entries: 2, only: "b", last_run: "2026-10-16" });
    expect(parseJsonText(settled.text ?? "")).toMatchObject({
      entries: { a: { hash: "1" }, b: { hash: "3" } },
      last_run: "2026-10-16",
    });
  });
});

describe("sayWhereItRead — the read_at decision", () => {
  const asked = { id: "nl-ind-blue-card", url: "https://example.org/permit" };
  const body = new Uint8Array([1]);

  it("gives one event when an ok reading was taken at another address", () => {
    expect(sayWhereItRead(asked, { ok: true, body, from: "https://example.org/permit/answered" })).toEqual({
      level: "info",
      msg: "watch:read_at",
      fields: { id: "nl-ind-blue-card", asked: "https://example.org/permit", read_at: "https://example.org/permit/answered" },
    });
  });

  it("gives none when the reading was taken at its own address", () => {
    expect(sayWhereItRead(asked, { ok: true, body, from: "https://example.org/permit" })).toBeUndefined();
    expect(sayWhereItRead(asked, { ok: true, body })).toBeUndefined();
  });

  it("gives none when the reading failed", () => {
    expect(sayWhereItRead(asked, { ok: false, error: "HTTP 503", failure: "transient" })).toBeUndefined();
  });
});

describe("parseJsonText — a hand-edited file", () => {
  it("parses a text with a leading BOM the same as one without", () => {
    const text = '{"entries":[{"id":"a"}]}';
    expect(parseJsonText("﻿" + text)).toEqual({ entries: [{ id: "a" }] });
    expect(parseJsonText(text)).toEqual({ entries: [{ id: "a" }] });
  });
});
