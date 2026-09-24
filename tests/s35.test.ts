import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  mergeTargetedRun, runWatch, runSummary, unreadNotices, verdictOf,
  type BrowserReader, type Fetcher, type FetchResult, type WatchEntry, type Watchlist, type WatchReport,
} from "../src/watch/core.js";
import {
  causeCode, classOfThrown, failureOfStatus, MOST_OF_A_FAILURE, ReadFailure, type FailureClass,
} from "../src/watch/failure.js";
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
/** The fixture state the scenario names: one source unread yesterday, and that
 * morning still inside the week this run looks back over. */
const alreadyUnread = (id: string): WatchState => ({
  entries: {}, last_run: YESTERDAY,
  unread: [{ id, url: addressOf(id) }], lapses: { [id]: [YESTERDAY] },
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

  it("takes a cause code only in the shape a cause code has", () => {
    // `cause.code` is Node's and undici's word — `ECONNRESET`, `ENOTFOUND`,
    // `UND_ERR_CONNECT_TIMEOUT` — and it is the one part of a cause that may
    // be printed, because it travels into a log line, a flag file and the
    // issue that flag becomes. Anything that is not that shape is something
    // else wearing the field's name, and then no code is printed at all
    // (Security review, 2026-09-24).
    expect(causeCode({ cause: { code: "ECONNRESET" } })).toBe("ECONNRESET");
    expect(causeCode({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })).toBe("UND_ERR_CONNECT_TIMEOUT");
    expect(
      causeCode({ cause: { code: "https://source.test/a?token=hunter2" } }),
      "an address wearing the code field's name was printed",
    ).toBeUndefined();
    expect(
      causeCode({ cause: { code: "E".repeat(4_000) } }),
      "a code as long as a page was printed",
    ).toBeUndefined();
    expect(causeCode({ cause: { code: "" } })).toBeUndefined();
    expect(causeCode(new Error("no cause at all"))).toBeUndefined();
  });

  it("bounds the words a failure carries, however long the page made them", () => {
    // A `ReadFailure` is the one failure whose message can be the SOURCE's
    // string: the browser tier throws a page's own exception `description`,
    // stack and all, and the stack names the page. The bound is here, at the
    // failure, so no thrower has to remember it (Security review,
    // 2026-09-24).
    const thrown = new ReadFailure(
      `Error: ${"A".repeat(10_000)}
    at https://source.test/x:1:1`, "refused-by-source",
    );
    expect(thrown.message.length).toBeLessThanOrEqual(MOST_OF_A_FAILURE);
    expect(thrown.message, "the page's own address travelled with its words").not.toContain("source.test");
    // A failure of ours is short and arrives whole.
    expect(new ReadFailure("the form has no such field", "refused-by-source").message)
      .toBe("the form has no such field");
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

describe("s35 — two silent mornings inside the week are an outage", () => {
  it("lists a source unread for the first time with today as its only silent morning", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), emptyState, fetcher, TODAY);
    // `unread` is what THIS run could not read, and nothing else: the site
    // counts it. The mornings are the other question, and they live apart.
    expect(nextState.unread).toEqual([{ id: "down", url: addressOf("down") }]);
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.outages).toEqual([]);
    // The day of grace: the site still says the run did not reach it, and the
    // run itself is green.
    expect(verdict.red, "a first unread day reddened the run").toBe(false);
  });

  it("keeps the earlier morning and reddens the run on the second one", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), alreadyUnread("down"), fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [YESTERDAY, TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.lapsed).toEqual([]);
    expect(verdict.red, "two silent mornings inside the week left the run green").toBe(true);
  });

  it("reddens the third run of a source that goes silent every other morning", async () => {
    // The hole the previous rule had, and the reason this one counts a week:
    // a source unread on alternating days was never on the run before, so it
    // was a lapse every morning, dropped off the list on its good day and
    // nothing accumulated anywhere. Four runs on four consecutive days —
    // silent, read, silent, read (DECISIONS 2026-09-24).
    const days = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"];
    const answers = [
      fail("refused-by-source", "HTTP 403"), page("it answered"),
      fail("refused-by-source", "HTTP 403"), page("it answered"),
    ];
    let state: WatchState = emptyState;
    const reds: boolean[] = [];
    for (const [i, day] of days.entries()) {
      const { fetcher } = scripted({ [addressOf("flaky")]: [answers[i]!] });
      const run = await runWatch(watching("flaky"), state, fetcher, day);
      state = run.nextState;
      reds.push(run.verdict.red);
    }
    expect(reds, "the second silent morning of an every-other-day source was green")
      .toEqual([false, false, true, false]);
    // And on the morning it answers it is not unread — the site must not say
    // the run failed to reach a source it reached — while the mornings it did
    // go silent are still on the state.
    expect(state.unread).toEqual([]);
    expect(state.lapses).toEqual({ flaky: ["2026-09-21", "2026-09-23"] });
  });

  it("forgets a silent morning older than the week, and calls the next one a lapse again", async () => {
    // Seven calendar days ending today. A source silent eight days ago and
    // again this morning has not been silent twice in the week the slice's
    // own claim is about, so the brake does not hold it.
    const stale: WatchState = {
      entries: {}, last_run: "2026-09-23", unread: [], lapses: { down: ["2026-09-16"] },
    };
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), stale, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red).toBe(false);
  });

  it("drops a source that answered off the unread list and keeps the mornings it was silent", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [page("it answered today")] });
    const { nextState, verdict } = await runWatch(watching("down"), alreadyUnread("down"), fetcher, TODAY);
    expect(nextState.unread).toEqual([]);
    expect(nextState.lapses, "the morning it was silent was forgotten the moment it answered")
      .toEqual({ down: [YESTERDAY] });
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
    // It is still an unread source like any other, and still counts a morning.
    expect(nextState.unread).toEqual([{ id: "offsite", url: addressOf("offsite") }]);
    expect(nextState.lapses).toEqual({ offsite: [TODAY] });
  });

  it("gives a refusal by the source the same day of grace as a hiccup", async () => {
    // A bot wall that answers tomorrow is exactly the morning this slice was
    // written for: six 403s on 2026-09-20 read clean on 09-21.
    const { fetcher } = scripted({ [addressOf("walled")]: [fail("refused-by-source", "HTTP 403")] });
    const { verdict } = await runWatch(watching("walled"), emptyState, fetcher, TODAY);
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["walled"]);
    expect(verdict.red).toBe(false);
  });

  it("counts a source silent on an earlier morning as an outage whatever failed this time", async () => {
    const { fetcher } = scripted({ [addressOf("walled")]: [fail("refused-by-source", "HTTP 403")] });
    const { verdict } = await runWatch(watching("walled"), alreadyUnread("walled"), fetcher, TODAY);
    expect(verdict.outages.map((u) => u.id)).toEqual(["walled"]);
    expect(verdict.red).toBe(true);
  });

  it("calls a refusal of ours with an earlier silent morning an outage, not a refusal", async () => {
    // One word per source, and membership in the week wins: two silent
    // mornings is the fact, whatever refused on which of them. The colour is
    // red either way, so nothing about the run moves — only what it is called.
    const { fetcher } = scripted({ [addressOf("offsite")]: [fail("refused-by-us", "redirected off the site")] });
    const { verdict } = await runWatch(watching("offsite"), alreadyUnread("offsite"), fetcher, TODAY);
    expect(verdict.outages.map((u) => u.id)).toEqual(["offsite"]);
    expect(verdict.refused).toEqual([]);
    expect(verdict.red).toBe(true);
  });

  it("reads a state written before this slice as the outage it is", async () => {
    // Every state on disk before today lists its unread sources with no days
    // at all. The source WAS unread on that run — that is what being on the
    // list means — so it counts as one silent morning, on the day that run
    // happened, and a second one inside the week is an outage. The two `bamf`
    // entries of 2026-09-24 come out exactly where the previous rule put them.
    const legacy: WatchState = {
      entries: {}, last_run: YESTERDAY, unread: [{ id: "down", url: addressOf("down") }],
    };
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), legacy, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [YESTERDAY, TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red).toBe(true);
  });

  it("starts empty on a state that has never recorded a silent morning", async () => {
    const { fetcher } = scripted({ [addressOf("down")]: [page("it answered")] });
    const { nextState } = await runWatch(watching("down"), { entries: {} }, fetcher, TODAY);
    expect(nextState.lapses).toEqual({});
  });

  it("keeps the mornings of the entries a targeted run never touched", async () => {
    const previous: WatchState = {
      entries: {}, last_run: YESTERDAY,
      unread: [
        { id: "untouched", url: addressOf("untouched") },
        { id: "targeted", url: addressOf("targeted") },
      ],
      lapses: { untouched: ["2026-09-20"], targeted: [YESTERDAY] },
    };
    const { fetcher } = scripted({ [addressOf("targeted")]: [page("it answered")] });
    const only = watching("targeted");
    const { nextState } = await runWatch(only, previous, fetcher, TODAY);
    const merged = mergeTargetedRun(previous, nextState, only);
    expect(merged.unread).toEqual([{ id: "untouched", url: addressOf("untouched") }]);
    // A targeted pass learned nothing about the sources it did not fetch, so
    // their mornings stand as the last full run left them; the one entry it
    // did fetch is the pass's to speak for.
    expect(merged.lapses).toEqual({ untouched: ["2026-09-20"], targeted: [YESTERDAY] });
  });
});

describe("s35 — the verdict is the run's, in one place", () => {
  const unreachable = (id: string, failure: FailureClass): WatchReport => ({
    id, url: addressOf(id), strategy: "html", kind: "value-source", outcome: "unreachable", failure,
  });
  const silent = (id: string, days: string[]): WatchState =>
    ({ entries: {}, unread: [{ id, url: addressOf(id) }], lapses: { [id]: days } });

  it("is red for an outage or a refusal of ours, and green for anything else", () => {
    const lapse = verdictOf([unreachable("fresh", "transient")], silent("fresh", [TODAY]));
    expect(lapse.red).toBe(false);
    expect(lapse.lapsed.map((u) => u.id)).toEqual(["fresh"]);

    const outage = verdictOf([unreachable("old", "transient")], silent("old", [YESTERDAY, TODAY]));
    expect(outage.red).toBe(true);
    // What the outage carries is the mornings themselves, so the line a
    // curator reads names them rather than counting them.
    expect(outage.outages[0]!.days).toEqual([YESTERDAY, TODAY]);

    const ours = verdictOf([unreachable("fresh", "refused-by-us")], silent("fresh", [TODAY]));
    expect(ours.red).toBe(true);

    // And a clean day is green and says nothing.
    const clean = verdictOf([], { entries: {}, unread: [], lapses: {} });
    expect(clean).toEqual({ lapsed: [], outages: [], refused: [], red: false });
  });

  it("is red for an unreachable source that arrived with no class at all", () => {
    // An unreachable report carries its class, and the type is what says so —
    // but a state on disk and a caller outside TypeScript are not bound by
    // it. An unknown failure is not a thing to be green about: it was not
    // retried either, and nobody was told why (Security review, 2026-09-24).
    const unclassed = { ...unreachable("mystery", "transient"), failure: undefined } as unknown as WatchReport;
    const verdict = verdictOf([unclassed], silent("mystery", [TODAY]));
    expect(verdict.lapsed, "a failure with no class was given a day of grace").toEqual([]);
    expect(verdict.red).toBe(true);
  });

  it("says each unread source once, and says an outage loudly", async () => {
    const { fetcher } = scripted({
      [addressOf("fresh")]: [fail("transient")],
      [addressOf("old")]: [fail("transient")],
      [addressOf("ours")]: [fail("refused-by-us")],
    });
    const previous: WatchState = {
      entries: {}, last_run: YESTERDAY,
      unread: [{ id: "old", url: addressOf("old") }], lapses: { old: ["2026-09-20"] },
    };
    const { verdict } = await runWatch(watching("fresh", "old", "ours"), previous, fetcher, TODAY);
    const notices = unreadNotices(verdict, TODAY);
    expect(notices.map((n) => [n.event, n.level, n.id])).toEqual([
      ["lapse", "warn", "fresh"],
      ["outage", "error", "old"],
      ["refused", "error", "ours"],
    ]);
    // An outage's line is the mornings it is made of, so a curator reads what
    // the brake counted rather than taking the word for it.
    const outage = notices.find((n) => n.event === "outage")!;
    expect(outage.days).toEqual(["2026-09-20", TODAY]);
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

  it("counts what the last run did not reach, and not what it merely remembers", () => {
    // The two lists answer two questions and the site only asks one. A source
    // the run read this morning is not one the run failed to reach, however
    // many mornings inside the week it was silent — so a source with days
    // behind it and no place on `unread` does not move the reader's count.
    const read: WatchState = {
      entries: { "es-uge-umbral-pdf": { hash: "h", retrieved_at: TODAY, history: [] } },
      last_run: TODAY,
      unread: [],
      lapses: { "es-uge-umbral-pdf": [YESTERDAY] },
    };
    const silent: WatchState = { ...read, unread: [{ id: "es-uge-umbral-pdf", url: UMBRAL }] };
    expect(unreadSources(dataset, read)).toEqual([]);
    expect(unreadSources(dataset, silent)).toHaveLength(1);
  });
});
