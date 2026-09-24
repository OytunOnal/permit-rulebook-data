import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  mergeTargetedRun, runWatch, runSummary, unreadNotices, verdictOf,
  type BrowserReader, type Fetcher, type FetchResult, type WatchEntry, type Watchlist, type WatchReport,
} from "../src/watch/core.js";
import { classOfThrown, failureOfStatus, ReadFailure, type FailureClass } from "../src/watch/failure.js";
import { unreadSources, type WatchState } from "../src/watch/state.js";
import type { Dataset } from "../src/types.js";

/**
 * s35 — a source that fails once is read again.
 *
 * Four of the five runs before this slice were red, and none of them for a
 * reason that was still there the next morning: six `HTTP 403`s that read
 * clean the following day, three `TypeError: fetch failed` whose cause was
 * never printed. The watch had no second try and could not tell a hiccup from
 * an outage, because every failure was one word.
 *
 * These cases are that word, split three ways — what the source refused, what
 * we refused, and what merely did not happen — and the three decisions that
 * hang off it: what is retried, what is red, and on which day.
 */

const TODAY = "2026-09-24";
const YESTERDAY = "2026-09-23";

const encode = (html: string) => new TextEncoder().encode(html);
const addressOf = (id: string) => `https://example.org/${id}`;

const page = (words: string): FetchResult => ({ ok: true, body: encode(`<p>${words}</p>`) });
/** A failure of a named class, in the shape a reader hands back. */
const fail = (failure: FailureClass, error: string = failure): FetchResult => ({ ok: false, error, failure });

/**
 * A reader that answers by script: one answer per call, per address, and the
 * last answer stands for every call after it.
 *
 * The scripts are the scenario's own — `[fail(transient), ok]`,
 * `[fail(transient), fail(transient)]`, `[fail(refused-by-source)]`,
 * `[fail(refused-by-us)]` — and what every case here measures is how many
 * times each address was asked and in what order, because that is the whole
 * of what a retry is.
 */
function scripted(script: Record<string, FetchResult[]>) {
  const calls: string[] = [];
  const answer = (address: string): FetchResult => {
    calls.push(address);
    const answers = script[address];
    if (!answers?.length) return page("unscripted");
    return answers.length > 1 ? answers.shift()! : answers[0]!;
  };
  const fetcher: Fetcher = async (url) => answer(url);
  const browser: BrowserReader = async (entry) => answer(entry.url);
  return { fetcher, browser, calls, asked: (id: string) => calls.filter((c) => c === addressOf(id)).length };
}

const entry = (id: string, overrides: Partial<WatchEntry> = {}): WatchEntry => ({
  id, url: addressOf(id), strategy: "html", kind: "value-source", ...overrides,
});
const watching = (...ids: string[]): Watchlist => ({ entries: ids.map((id) => entry(id)) });
const reportFor = (reports: WatchReport[], id: string): WatchReport =>
  reports.find((r) => r.id === id) ?? (() => { throw new Error(`no report for ${id}`); })();

const emptyState: WatchState = { entries: {} };
/** The fixture state the scenario names: one source already unread, since yesterday. */
const alreadyUnread = (id: string): WatchState => ({
  entries: {}, last_run: YESTERDAY, unread: [{ id, url: addressOf(id), since: YESTERDAY }],
});

describe("s35 — a failure has a class, and the reader names it", () => {
  it("calls the answers a source may repeat in a minute transient, and its refusals its own", () => {
    // The split is the whole slice: what is retried, what reddens the day and
    // what waits a day all key on this one word. 408, 425 and 429 are the
    // source asking for a moment; every 5xx is the source calling it its own
    // fault; every other 4xx is an answer that will be the same in three
    // minutes — a bot wall, a moved page, a page that is gone.
    for (const status of [408, 425, 429, 500, 502, 503, 504, 599])
      expect(failureOfStatus(status), `HTTP ${status} is not worth a second try`).toBe("transient");
    for (const status of [400, 401, 403, 404, 410, 418, 451])
      expect(failureOfStatus(status), `HTTP ${status} was treated as a hiccup`).toBe("refused-by-source");
  });

  it("calls a budget that ran out transient, without waiting one out to say so", () => {
    // The budget is 30 s per source and is not injectable (s34, DECISIONS
    // 2026-09-24), so this asks the error path what it decides rather than
    // holding a test open for half a minute. `AbortSignal.timeout` rejects
    // with exactly this.
    expect(classOfThrown(new DOMException("The operation was aborted due to timeout", "TimeoutError")))
      .toBe("transient");
    // And a throw nobody anticipated is worth one more try rather than a red
    // morning: the floor refusing an address is a decision we made, and this
    // is not one.
    expect(classOfThrown(new Error("something nobody wrote down"))).toBe("transient");
  });

  it("lets a reader carry its own class out of a throw", () => {
    // The browser tier's failures are thrown, several layers down — a step
    // that finds no field, a navigation off the origin, a page that never
    // settles — and the class is decided where the fact is known rather than
    // guessed from the wording afterwards.
    expect(classOfThrown(new ReadFailure("the form has no such field", "refused-by-source")))
      .toBe("refused-by-source");
    expect(classOfThrown(new ReadFailure("the page is at another origin", "refused-by-us")))
      .toBe("refused-by-us");
  });
});

describe("s35 — a transient failure is read again, after the pass", () => {
  it("reads a source that answers the second time, and reports what it answered", async () => {
    const { fetcher, calls, asked } = scripted({
      [addressOf("hiccup")]: [fail("transient", "fetch failed (ECONNRESET)"), page("the authority's words")],
      [addressOf("steady")]: [page("steady words")],
    });
    const { reports } = await runWatch(watching("hiccup", "steady"), emptyState, fetcher, TODAY);
    // The second answer replaces the first report entirely: this is a source
    // that was read today, not one that failed and was forgiven.
    expect(reportFor(reports, "hiccup").outcome).toBe("baseline");
    expect(reportFor(reports, "hiccup").error).toBeUndefined();
    expect(asked("hiccup"), "the failure was not read again").toBe(2);
    expect(asked("steady"), "a source that answered was read twice").toBe(1);
    expect(calls.length).toBe(3);
  });

  it("writes the snapshot the second answer carried", async () => {
    const { fetcher } = scripted({
      [addressOf("hiccup")]: [fail("transient"), page("the authority's words")],
    });
    const { nextState, verdict } = await runWatch(watching("hiccup"), emptyState, fetcher, TODAY);
    expect(nextState.entries["hiccup"], "the second reading was not kept").toBeDefined();
    expect(nextState.entries["hiccup"]!.text).toContain("the authority's words");
    expect(nextState.unread, "a source that was read is still listed unread").toEqual([]);
    expect(verdict.red).toBe(false);
  });

  it("asks again only after the last source of the first pass, not beside it", async () => {
    // The gap IS the rest of the pass — about three minutes on the runner —
    // and that is the only thing making the second try worth anything. A
    // retry taken where the failure happened asks the same second over again.
    const { fetcher, calls } = scripted({
      [addressOf("hiccup")]: [fail("transient"), page("the authority's words")],
      [addressOf("second")]: [page("second")],
      [addressOf("third")]: [page("third")],
    });
    await runWatch(watching("hiccup", "second", "third"), emptyState, fetcher, TODAY);
    expect(calls).toEqual([addressOf("hiccup"), addressOf("second"), addressOf("third"), addressOf("hiccup")]);
  });

  it("leaves the reports in the watchlist's order, wherever the retry happened", async () => {
    const { fetcher } = scripted({ [addressOf("hiccup")]: [fail("transient"), page("words")] });
    const { reports } = await runWatch(watching("first", "hiccup", "last"), emptyState, fetcher, TODAY);
    expect(reports.map((r) => r.id)).toEqual(["first", "hiccup", "last"]);
  });

  it("asks a source that refused us nothing more", async () => {
    // Neither refusal is a question of timing. A 403 is a bot wall and a 404
    // is a page that moved: both answer the same in three minutes, and asking
    // twice is asking a wall to change its mind.
    const { fetcher, asked } = scripted({
      [addressOf("walled")]: [fail("refused-by-source", "HTTP 403")],
      [addressOf("ours")]: [fail("refused-by-us", "redirected off the site")],
    });
    const { reports } = await runWatch(watching("walled", "ours"), emptyState, fetcher, TODAY);
    expect(asked("walled"), "a refusal by the source was read again").toBe(1);
    expect(asked("ours"), "a refusal of ours was read again").toBe(1);
    expect(reportFor(reports, "walled").outcome).toBe("unreachable");
    expect(reportFor(reports, "ours").outcome).toBe("unreachable");
  });

  it("stands by a second failure, and reports that one", async () => {
    const { fetcher, asked } = scripted({
      [addressOf("down")]: [fail("transient", "fetch failed (ECONNRESET)"), fail("transient", "fetch failed (ETIMEDOUT)")],
    });
    const { reports } = await runWatch(watching("down"), emptyState, fetcher, TODAY);
    expect(asked("down")).toBe(2);
    expect(reportFor(reports, "down").outcome).toBe("unreachable");
    // The report a person reads is the second answer, not the first: the
    // first is over, and what stands is what the source said last.
    expect(reportFor(reports, "down").error).toContain("ETIMEDOUT");
  });

  it("reads a browser entry again with the browser, and opens it once more", async () => {
    // One more open, on the same reader the pass was given: a browser entry's
    // second try is a second render, not a fetch of the shell behind it.
    const { fetcher, browser, asked } = scripted({
      [addressOf("rendered")]: [fail("transient", "the browser did not finish this page within 30s"), page("rendered words")],
    });
    const { reports } = await runWatch(
      { entries: [entry("rendered", { strategy: "browser" })] }, emptyState, fetcher, TODAY, browser,
    );
    expect(asked("rendered"), "the browser entry was not opened a second time").toBe(2);
    expect(reportFor(reports, "rendered").outcome).toBe("baseline");
  });

  it("gives an empty body a second try and a page that changed under us none", async () => {
    // Both are decided inside the pass rather than by a reader: an empty body
    // is EUR-Lex's challenge and is over in a minute; a slice marker that is
    // no longer on the page is the page having changed, which no second read
    // will undo.
    const { fetcher, asked } = scripted({
      [addressOf("empty")]: [{ ok: true, body: new Uint8Array(0) }, page("the words came back")],
      [addressOf("sliced")]: [page("nothing the markers bound")],
    });
    const list: Watchlist = {
      entries: [entry("empty"), entry("sliced", { slice: { from: "Lede:", to: "Foot:" } })],
    };
    const { reports } = await runWatch(list, emptyState, fetcher, TODAY);
    expect(asked("empty"), "an empty body was not asked again").toBe(2);
    expect(reportFor(reports, "empty").outcome).toBe("baseline");
    expect(asked("sliced"), "a missing slice marker was read again").toBe(1);
    expect(reportFor(reports, "sliced").outcome).toBe("unreachable");
    expect(reportFor(reports, "sliced").failure).toBe("refused-by-source");
  });

  it("does not open a browser twice for a run that was given no reader", async () => {
    // A run with no browser reader has not opened these pages and says so,
    // and that is our own gap and not a source's minute: nothing is retried.
    const { fetcher, asked } = scripted({});
    const { reports } = await runWatch(
      { entries: [entry("rendered", { strategy: "browser" })] }, emptyState, fetcher, TODAY,
    );
    expect(reportFor(reports, "rendered").outcome).toBe("unreachable");
    expect(reportFor(reports, "rendered").failure).toBe("refused-by-us");
    expect(asked("rendered")).toBe(0);
  });
});

describe("s35 — one unread day is a lapse, two in a row an outage", () => {
  it("lists a source unread for the first time with today as the day it started", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), emptyState, fetcher, TODAY);
    expect(nextState.unread).toEqual([{ id: "down", url: addressOf("down"), since: TODAY }]);
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.outages).toEqual([]);
    // The day of grace: the site still says the run did not reach it, and the
    // run itself is green.
    expect(verdict.red, "a first unread day reddened the run").toBe(false);
  });

  it("keeps the day it started when the same source is unread again", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), alreadyUnread("down"), fetcher, TODAY);
    expect(nextState.unread).toEqual([{ id: "down", url: addressOf("down"), since: YESTERDAY }]);
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.lapsed).toEqual([]);
    expect(verdict.red, "two unread days in a row left the run green").toBe(true);
  });

  it("drops a source that answered off the list, and its day with it", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [page("it answered today")] });
    const { nextState, verdict } = await runWatch(watching("down"), alreadyUnread("down"), fetcher, TODAY);
    expect(nextState.unread).toEqual([]);
    expect(verdict.red).toBe(false);
  });

  it("reddens a refusal of ours on its first day", async () => {
    // Waiting a day changes nothing about an address this watch will not
    // request. A source that starts redirecting off-site, or an entry
    // carrying credentials, is a finding for the curator this morning.
    const { fetcher } = scripted({
      [addressOf("offsite")]: [fail("refused-by-us", "redirected off the site: asked https://example.org, sent to https://elsewhere.test/x")],
    });
    const { verdict, nextState } = await runWatch(watching("offsite"), emptyState, fetcher, TODAY);
    expect(verdict.refused.map((u) => u.id)).toEqual(["offsite"]);
    expect(verdict.lapsed, "a refusal of ours was given a day of grace").toEqual([]);
    expect(verdict.red).toBe(true);
    // It is still an unread source like any other, and still says since when.
    expect(nextState.unread).toEqual([{ id: "offsite", url: addressOf("offsite"), since: TODAY }]);
  });

  it("gives a refusal by the source the same day of grace as a hiccup", async () => {
    // A bot wall that answers tomorrow is exactly the morning this slice was
    // written for: six 403s on 2026-09-20 read clean on 09-21.
    const { fetcher } = scripted({ [addressOf("walled")]: [fail("refused-by-source", "HTTP 403")] });
    const { verdict } = await runWatch(watching("walled"), emptyState, fetcher, TODAY);
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["walled"]);
    expect(verdict.red).toBe(false);
  });

  it("counts a source unread on the run before as an outage whatever failed this time", async () => {
    const { fetcher } = scripted({ [addressOf("walled")]: [fail("refused-by-source", "HTTP 403")] });
    const { verdict } = await runWatch(watching("walled"), alreadyUnread("walled"), fetcher, TODAY);
    expect(verdict.outages.map((u) => u.id)).toEqual(["walled"]);
    expect(verdict.red).toBe(true);
  });

  it("reads a state written before this slice as the outage it is", async () => {
    // Every state on disk before today lists its unread sources without a
    // day. The source WAS unread on the run before — that is what being on
    // that list means — so it is an outage, and the earliest day this run can
    // honestly claim for it is the day that run happened.
    const legacy: WatchState = {
      entries: {}, last_run: YESTERDAY, unread: [{ id: "down", url: addressOf("down") }],
    };
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), legacy, fetcher, TODAY);
    expect(nextState.unread).toEqual([{ id: "down", url: addressOf("down"), since: YESTERDAY }]);
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red).toBe(true);
  });

  it("keeps the day on the entries a targeted run never touched", async () => {
    const previous: WatchState = {
      entries: {}, last_run: YESTERDAY,
      unread: [
        { id: "untouched", url: addressOf("untouched"), since: "2026-09-20" },
        { id: "targeted", url: addressOf("targeted"), since: YESTERDAY },
      ],
    };
    const { fetcher } = scripted({ [addressOf("targeted")]: [page("it answered")] });
    const only = watching("targeted");
    const { nextState } = await runWatch(only, previous, fetcher, TODAY);
    const merged = mergeTargetedRun(previous, nextState, only);
    expect(merged.unread).toEqual([{ id: "untouched", url: addressOf("untouched"), since: "2026-09-20" }]);
  });
});

describe("s35 — the verdict is the run's, in one place", () => {
  it("is red for an outage or a refusal of ours, and green for anything else", () => {
    const unread = (id: string, since: string) => ({ id, url: addressOf(id), since });
    const unreachable = (id: string, failure: WatchReport["failure"]): WatchReport => ({
      id, url: addressOf(id), strategy: "html", kind: "value-source", outcome: "unreachable", failure,
    });
    const previous: WatchState = { entries: {}, unread: [unread("old", YESTERDAY)] };

    const lapse = verdictOf(
      [unreachable("fresh", "transient")],
      { entries: {}, unread: [unread("fresh", TODAY)] }, previous,
    );
    expect(lapse.red).toBe(false);
    expect(lapse.lapsed.map((u) => u.id)).toEqual(["fresh"]);

    const outage = verdictOf(
      [unreachable("old", "transient")],
      { entries: {}, unread: [unread("old", YESTERDAY)] }, previous,
    );
    expect(outage.red).toBe(true);

    const ours = verdictOf(
      [unreachable("fresh", "refused-by-us")],
      { entries: {}, unread: [unread("fresh", TODAY)] }, previous,
    );
    expect(ours.red).toBe(true);

    // And a clean day is green and says nothing.
    const clean = verdictOf([], { entries: {}, unread: [] }, previous);
    expect(clean).toEqual({ lapsed: [], outages: [], refused: [], red: false });
  });

  it("says each unread source once, and says an outage loudly", async () => {
    const { fetcher } = scripted({
      [addressOf("fresh")]: [fail("transient")],
      [addressOf("old")]: [fail("transient")],
      [addressOf("ours")]: [fail("refused-by-us")],
    });
    const previous: WatchState = {
      entries: {}, last_run: YESTERDAY, unread: [{ id: "old", url: addressOf("old"), since: "2026-09-20" }],
    };
    const { verdict } = await runWatch(watching("fresh", "old", "ours"), previous, fetcher, TODAY);
    const notices = unreadNotices(verdict, TODAY);
    expect(notices.map((n) => [n.event, n.level, n.id])).toEqual([
      ["lapse", "warn", "fresh"],
      ["outage", "error", "old"],
      ["refused", "error", "ours"],
    ]);
    // An outage is the one line that carries both days: the morning it
    // started and the morning it is still going.
    const outage = notices.find((n) => n.event === "outage")!;
    expect(outage.since).toBe("2026-09-20");
    expect(outage.today).toBe(TODAY);
  });

  it("counts a green day with a lapse in the line the run ends on", async () => {
    // Visible in the log and not only in the state: a day the watch was
    // green and still did not read everything is a day somebody should be
    // able to see without opening `watch/state.json`.
    const { fetcher } = scripted({
      [addressOf("fresh")]: [fail("transient")],
      [addressOf("changed")]: [page("new words")],
    });
    const previous: WatchState = {
      entries: { changed: { hash: "old", retrieved_at: YESTERDAY, history: [] } }, last_run: YESTERDAY,
    };
    const { reports, verdict } = await runWatch(watching("fresh", "changed"), previous, fetcher, TODAY);
    expect(runSummary(reports, verdict)).toEqual({
      total: 2, changed: 1, unreachable: 1, lapsed: 1, outages: 0, refused: 0,
    });
    expect(verdict.red).toBe(false);
  });
});

describe("s35 — the site reads what it read", () => {
  const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
  /** Spain's salary-threshold PDF — five dataset values rest on it. */
  const UMBRAL = "https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf";

  it("counts an unread source with a day on it exactly as it counted one without", () => {
    const without: WatchState = {
      entries: { "es-uge-umbral-pdf": { hash: "h", retrieved_at: "2026-09-07", history: [] } },
      last_run: TODAY,
      unread: [{ id: "es-uge-umbral-pdf", url: UMBRAL }],
    };
    const with_since: WatchState = {
      ...without, unread: [{ id: "es-uge-umbral-pdf", url: UMBRAL, since: YESTERDAY }],
    };
    // `since` is an added field the site ignores: the reader on a lapse day
    // still sees "the last run did not reach 1", because that is true.
    expect(unreadSources(dataset, with_since)).toEqual(unreadSources(dataset, without));
    expect(unreadSources(dataset, with_since)).toHaveLength(1);
  });
});
