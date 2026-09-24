import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  mergeTargetedRun, runWatch, runSummary, unreadNotices, verdictOf,
  type BrowserReader, type Fetcher, type FetchResult, type WatchEntry, type Watchlist, type WatchReport,
} from "../src/watch/core.js";
import {
  causeCode, classOfThrown, failureOfStatus, MOST_OF_A_FAILURE, ReadFailure, shortFailure,
  type FailureClass,
} from "../src/watch/failure.js";
import { servedFailure } from "../src/watch/cdp.js";
import { printableAddress } from "../src/watch/fetch-source.js";
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
const TOMORROW = "2026-09-25";

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

  it("keeps as much of a source's own words as a person can read, and no more", () => {
    // The browser tier throws a page's own exception `description`, stack and
    // all, and the stack names the page. What survives has to be the bound
    // and not the page (Security review, 2026-09-24). The call site is
    // pinned against a real Chrome in `tests/s34-browser.test.ts`; this is
    // the rule itself.
    const said = `Error: ${"A".repeat(10_000)}
    at https://source.test/x:1:1`;
    const words = shortFailure(said);
    expect(words.length, "a page decided how long a log line is").toBeLessThanOrEqual(MOST_OF_A_FAILURE);
    expect(words, "the page's own address travelled with its words").not.toContain("source.test");
    // What is left is the beginning of what the page said and not a
    // rewriting of it — asked of the first half of the bound, which is
    // inside whatever the reading costs at the end.
    expect(said.startsWith(words.slice(0, MOST_OF_A_FAILURE / 2)), "what survives is not how the page began")
      .toBe(true);
    // And a failure a person can already read is not touched.
    const brief = "Error: the page said no";
    expect(shortFailure(brief), "a failure short enough to read was cut anyway").toBe(brief);
    // And a failure of OURS is not bound by it. The step diagnosis that names
    // what the page offered instead of the option asked for runs to five
    // hundred characters on purpose, and is the whole of what a curator acts
    // on — so the bound lives at the throw that takes a source's string, not
    // on every failure the browser tier makes.
    const ours = "step select: the option is not in the field. The field offered: " + "x".repeat(400);
    expect(new ReadFailure(ours, "refused-by-source").message, "our own diagnosis was cut").toBe(ours);
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

  it("names the address a browser redirect ended at the way every address is named", () => {
    // Where the tab ended up is the SOURCE's choice: a redirect goes
    // wherever the response says, credentials and all, and the address lands
    // in the public run log beside every other one. It is printed by the one
    // rule that prints an address — credentials out, bounded — and not raw
    // (Security review, 2026-09-24).
    const sent = `https://watcher:hunter2@elsewhere.test/${"a".repeat(1_000)}`;
    const failure = servedFailure(403, sent, addressOf("rendered"));
    expect(failure.message, "the password the source put in the address was printed")
      .not.toContain("hunter2");
    expect(failure.message, "the address was printed as the source wrote it").toContain(printableAddress(sent));
    expect(failure.message.length, "the whole of the address was printed").toBeLessThan(sent.length);
    // And it is a failure like any other: the status says whose it is.
    expect(failure.failure).toBe("refused-by-source");
    // A response from the address that was asked for is not a redirect, and
    // says nothing about an address at all.
    expect(servedFailure(503, addressOf("rendered"), addressOf("rendered")).message)
      .not.toContain(addressOf("rendered"));
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

  it("reports a retried read that matches the snapshot as unchanged, and does not move its day", async () => {
    // Every other retry case here runs against an empty state and lands on
    // `baseline`, which is the one outcome that cannot show this: a second
    // read is a read like any other, so a source whose words did not move is
    // `unchanged` and keeps the day the reading it still stands on was taken
    // (Spec review, 2026-09-24).
    const words = "the authority's words";
    const first = await runWatch(
      watching("hiccup"), emptyState, scripted({ [addressOf("hiccup")]: [page(words)] }).fetcher, YESTERDAY,
    );
    const { fetcher, asked } = scripted({ [addressOf("hiccup")]: [fail("transient"), page(words)] });
    const { reports, nextState } = await runWatch(watching("hiccup"), first.nextState, fetcher, TODAY);
    expect(asked("hiccup"), "the failure was not read again").toBe(2);
    expect(reportFor(reports, "hiccup").outcome).toBe("unchanged");
    expect(nextState.entries["hiccup"]!.retrieved_at, "a confirming read moved the day of the reading")
      .toBe(YESTERDAY);
    expect(nextState.entries["hiccup"]!.history, "a reading that did not change was filed as history")
      .toEqual([]);
  });

  it("reports a retried read that differs as changed, and keeps what it replaced", async () => {
    const first = await runWatch(
      watching("hiccup"), emptyState, scripted({ [addressOf("hiccup")]: [page("the old words")] }).fetcher, YESTERDAY,
    );
    const was = first.nextState.entries["hiccup"]!.hash;
    const { fetcher } = scripted({ [addressOf("hiccup")]: [fail("transient"), page("the new words")] });
    const { reports, nextState } = await runWatch(watching("hiccup"), first.nextState, fetcher, TODAY);
    expect(reportFor(reports, "hiccup").outcome).toBe("changed");
    expect(reportFor(reports, "hiccup").old_hash).toBe(was);
    expect(nextState.entries["hiccup"]!.retrieved_at).toBe(TODAY);
    expect(nextState.entries["hiccup"]!.history.map((h) => h.hash)).toEqual([was]);
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

  it("counts the sixth morning back and lets the seventh go", async () => {
    // The window's own edge, from both sides. Seven calendar days ending
    // today: 2026-09-17 is the seventh morning back from 2026-09-24 and the
    // one the week has just left; 2026-09-18 is the sixth and still inside
    // it. A day either way is a brake that holds a morning it should have
    // let go, or lets an outage through.
    const edge = async (day: string) => {
      const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
      return runWatch(watching("down"), {
        entries: {}, last_run: YESTERDAY, unread: [], lapses: { down: [day] },
      }, fetcher, TODAY);
    };
    const gone = await edge("2026-09-17");
    expect(gone.nextState.lapses).toEqual({ down: [TODAY] });
    expect(gone.verdict.red, "a morning the week had left still reddened the run").toBe(false);

    const held = await edge("2026-09-18");
    expect(held.nextState.lapses).toEqual({ down: ["2026-09-18", TODAY] });
    expect(held.verdict.red, "a morning inside the week was forgotten").toBe(true);
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
    const merged = mergeTargetedRun(previous, nextState, only, TODAY);
    expect(merged.unread).toEqual([{ id: "untouched", url: addressOf("untouched") }]);
    // A targeted pass learned nothing about the sources it did not fetch, so
    // their mornings stand as the last full run left them; the one entry it
    // did fetch is the pass's to speak for.
    expect(merged.lapses).toEqual({ untouched: ["2026-09-20"], targeted: [YESTERDAY] });
  });

  it("migrates the untouched sources' mornings on a state that carries none", async () => {
    // The shape every state on disk has this morning: sources listed unread
    // with no days at all. A targeted pass writes a `lapses` where there was
    // none, and a written `lapses` is what stops the next full run migrating
    // — so if the pass does not migrate the sources it never fetched, their
    // mornings are gone for good and the week starts them over (Spec review,
    // 2026-09-24).
    const legacy: WatchState = {
      entries: {}, last_run: YESTERDAY,
      unread: [
        { id: "one", url: addressOf("one") },
        { id: "two", url: addressOf("two") },
      ],
    };
    const { fetcher } = scripted({ [addressOf("three")]: [fail("transient")] });
    const only = watching("three");
    const { nextState } = await runWatch(only, legacy, fetcher, TODAY);
    const merged = mergeTargetedRun(legacy, nextState, only, TODAY);
    expect(merged.lapses).toEqual({ one: [YESTERDAY], two: [YESTERDAY], three: [TODAY] });

    // And the morning after, a full run counts their second silent morning
    // rather than calling it their first.
    const { fetcher: again } = scripted({
      [addressOf("one")]: [fail("transient")],
      [addressOf("two")]: [fail("transient")],
      [addressOf("three")]: [page("it answered")],
    });
    const full = await runWatch(watching("one", "two", "three"), merged, again, TOMORROW);
    expect(full.verdict.outages.map((u) => u.id)).toEqual(["one", "two"]);
    expect(full.verdict.red, "a migrated morning was lost through the targeted pass").toBe(true);
  });

  it("gives a targeted pass the migrated morning of the entry it did fetch", async () => {
    // The pass reads the same state, so it counts the same silent morning:
    // an entry the migration gave one morning and the pass could not read
    // either is an outage, on the pass's own days.
    const legacy: WatchState = {
      entries: {}, last_run: YESTERDAY,
      unread: [
        { id: "one", url: addressOf("one") },
        { id: "two", url: addressOf("two") },
      ],
    };
    const { fetcher } = scripted({ [addressOf("one")]: [fail("transient")] });
    const only = watching("one");
    const { nextState, verdict } = await runWatch(only, legacy, fetcher, TODAY);
    expect(verdict.outages.map((u) => u.id)).toEqual(["one"]);
    const merged = mergeTargetedRun(legacy, nextState, only, TODAY);
    expect(merged.lapses).toEqual({ one: [YESTERDAY, TODAY], two: [YESTERDAY] });
  });
});

/**
 * The state file is input, and the days on it are read before they are
 * counted and printed.
 *
 * `watch/state.json` is a file in the repository: what it holds is whatever
 * the last run wrote, whatever a curator's editor did to it, and whatever a
 * commit put there. The run reads its days in one place, and that is where
 * they are refused — a day that is not a day, a list that is not a list, a
 * week's worth and no more — because a run that dies on the shape of a field
 * reads no source at all, and a line in the public run log carries whatever
 * it was handed (Security review, 2026-09-24).
 */
describe("s35 — the days on the state are read as days or not at all", () => {
  /** The day `n` mornings after today, in the shape the state writes. */
  const daysAfter = (n: number) => new Date(Date.parse(TODAY) + n * 86_400_000).toISOString().slice(0, 10);
  const stateWith = (lapses: unknown, ...ids: string[]): WatchState => ({
    entries: {}, last_run: YESTERDAY,
    unread: ids.map((id) => ({ id, url: addressOf(id) })),
    lapses,
  } as unknown as WatchState);

  it("reads and reports on a state whose lapses are not a record of days", async () => {
    // A `lapses` that is a string is not a claim about days — and the run
    // used to die on it inside `days.filter`, which is a watch that reads no
    // source because one field was the wrong shape. What is left to read is
    // the unread list, which is exactly what a state naming no days at all
    // means, so the migration counts its morning.
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), stateWith("x", "down"), fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [YESTERDAY, TODAY] });
    expect(verdict.red).toBe(true);
    expect(unreadNotices(verdict, TODAY).map((n) => n.event)).toEqual(["outage"]);
  });

  it("carries at most the week's worth of days out of a state that holds thousands", async () => {
    // The days go into the run's log line, and a state author must not be
    // able to print a page of them. Seven calendar days is the whole of what
    // the brake counts (DECISIONS 2026-09-24), so seven is the whole of what
    // a source's week can hold.
    //
    // The days run backwards from today: a day ahead of today is refused
    // outright as a morning that has not happened (s35 delta 4), so a flood
    // of yesterdays is what a state author has to work with — and seven of
    // them are inside the week whatever the other 9,993 say.
    const flood = Array.from({ length: 10_000 }, (_, i) => daysAfter(-i));
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), stateWith({ down: flood }, "down"), fetcher, TODAY);
    expect(nextState.lapses!["down"]!.length, "a page of days reached the state the run writes")
      .toBeLessThanOrEqual(7);
    const notice = unreadNotices(verdict, TODAY)[0]!;
    expect(notice.days.length, "a page of days reached the line the run prints").toBeLessThanOrEqual(7);
  });

  it("drops a day that is not a day and counts the ones that are", async () => {
    // The shape check is the one place a day is refused: what survives it is
    // a morning the brake can count, and the rest is not silently believed.
    const { fetcher } = scripted({
      [addressOf("down")]: [fail("transient")],
      [addressOf("alone")]: [fail("transient")],
    });
    const state = stateWith({ down: ["not-a-day", YESTERDAY, "2026-02-30"], alone: ["not-a-day"] }, "down");
    const { nextState, verdict } = await runWatch(watching("down", "alone"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [YESTERDAY, TODAY], alone: [TODAY] });
    // `down` kept the one real morning and is out; `alone` was on no unread
    // list, so nothing says it was ever silent before and its refused days
    // leave it this morning alone, with its day of grace.
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["alone"]);
  });

  it("drops a day wearing a day's first ten characters", async () => {
    // `Date.parse` takes a whole timestamp and would call this a morning;
    // the state writes days, and a day is ten characters long. Anything
    // else is something else wearing the shape of one — and this source is
    // on no unread list, so the timestamp is the only thing that could speak
    // for a morning before today.
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const state = stateWith({ down: [`${YESTERDAY}T07:00:00Z`] });
    const { nextState, verdict } = await runWatch(watching("down"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.red, "a timestamp was counted as a silent morning").toBe(false);
  });

  it("counts the migrated morning of a source whose every recorded day was refused", async () => {
    // A record that names one day, one hyphen short of being one. Refusing
    // the day must not also cancel the migration: the source is on the unread
    // list, so it WAS silent on the morning of the run that listed it, and
    // dropping that morning turns an outage green — the same corruption
    // deciding two ways depending on which branch read it (Security review,
    // 2026-09-24).
    const { fetcher } = scripted({ [addressOf("bamf")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(
      watching("bamf"), stateWith({ bamf: ["2026-9-23"] }, "bamf"), fetcher, TODAY,
    );
    expect(nextState.lapses).toEqual({ bamf: [YESTERDAY, TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["bamf"]);
    expect(verdict.red, "a refused day cancelled the migration and the outage with it").toBe(true);
  });

  it("migrates the source whose days were refused beside the one whose days were read", async () => {
    // One record, two sources: the days are read per source, so one id's
    // corruption is not the other id's loss and not its own free pass.
    const { fetcher } = scripted({
      [addressOf("kept")]: [fail("transient")],
      [addressOf("refused")]: [fail("transient")],
    });
    const state = stateWith({ kept: ["2026-09-20"], refused: "not a list of days" }, "kept", "refused");
    const { nextState, verdict } = await runWatch(watching("kept", "refused"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ kept: ["2026-09-20", TODAY], refused: [YESTERDAY, TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["kept", "refused"]);
  });

  it("does not write an empty lapses over the migration on a targeted pass", async () => {
    // The same crafted record through `--only`. A written `lapses` is what
    // stops the next full run migrating, so a pass that writes `{}` here
    // makes the lost morning permanent: the source's week starts over and
    // its next silence is called its first (Security review, 2026-09-24).
    const previous = stateWith({ bamf: ["2026-9-23"] }, "bamf");
    const { fetcher } = scripted({ [addressOf("other")]: [page("it answered")] });
    const only = watching("other");
    const { nextState } = await runWatch(only, previous, fetcher, TODAY);
    const merged = mergeTargetedRun(previous, nextState, only, TODAY);
    expect(merged.lapses).toEqual({ bamf: [YESTERDAY] });
  });

  it("carries no morning at all when the day the migration would use is not a day", async () => {
    // `last_run` comes off the same file as `lapses` and becomes a day the
    // brake counts and the run prints, so it takes the same check — and what
    // a failed check means here is a decision. The migration is the bridge
    // from the states on disk, and every one of them carries a day
    // (`watch/state.json`: `last_run: "2026-09-24"`), so a file whose
    // `last_run` is not a day is corrupt past this migration's reading and
    // names no morning. Stamping today instead recorded a silent morning for
    // a source that answered this morning (Security review, 2026-09-24).
    const unreadable = (...ids: string[]) => ({
      entries: {}, last_run: "yesterday",
      unread: ids.map((id) => ({ id, url: addressOf(id) })),
    } as unknown as WatchState);

    // A source on that list which reads clean today has nothing against it:
    // off the unread list, and no day anywhere.
    const { fetcher: clean } = scripted({ [addressOf("read")]: [page("it answered")] });
    const answered = await runWatch(watching("read"), unreadable("read"), clean, TODAY);
    expect(answered.nextState.unread).toEqual([]);
    expect(answered.nextState.lapses, "a source that answered was recorded silent").toEqual({});
    expect(answered.verdict.red).toBe(false);

    // And one silent this morning has the morning this run watched it be
    // silent, which is its first: a lapse, and green.
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(watching("down"), unreadable("down"), fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red, "a single silence was red on a state whose `last_run` could not be read").toBe(false);

    // The morning after, that silence is the second one and the run is red.
    const { fetcher: again } = scripted({ [addressOf("down")]: [fail("transient")] });
    const after = await runWatch(watching("down"), nextState, again, TOMORROW);
    expect(after.nextState.lapses).toEqual({ down: [TODAY, TOMORROW] });
    expect(after.verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(after.verdict.red, "a second silent morning left the run green").toBe(true);

    // A targeted pass reads the same file and invents no morning either.
    const only = watching("other");
    const { fetcher: passing } = scripted({ [addressOf("other")]: [page("it answered")] });
    const pass = await runWatch(only, unreadable("down"), passing, TODAY);
    expect(mergeTargetedRun(unreadable("down"), pass.nextState, only, TODAY).lapses).toBeUndefined();
  });

  it("keeps the week's most recent mornings, not the last seven a list happens to end with", async () => {
    // A state's list is not promised to be in the order a run wrote it, and
    // the cap is a bound on how many mornings a week can hold — not a choice
    // of which ones. Eight August days written after yesterday's push it off
    // the end of the list, and then all eight prune out: a source silent
    // yesterday and again this morning would report a lapse and exit 0 where
    // the brake says outage (Spec review, 2026-09-24).
    const august = Array.from({ length: 8 }, (_, i) => `2026-08-${String(10 + i).padStart(2, "0")}`);
    const { fetcher } = scripted({ [addressOf("x")]: [fail("transient")] });
    const state = stateWith({ x: [YESTERDAY, ...august] }, "x");
    const { nextState, verdict } = await runWatch(watching("x"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ x: [YESTERDAY, TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["x"]);
    expect(verdict.red, "the week's own morning was cut by a cap made of older days").toBe(true);
  });

  it("counts a morning written twice as the one morning it is", async () => {
    // The brake counts mornings, so a list repeating one of them would make a
    // single silence look like an outage — and this source has been silent
    // once, this morning, however many times the state says so.
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const state = stateWith({ down: [TODAY, TODAY] });
    const { nextState, verdict } = await runWatch(watching("down"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red, "one silence written twice was read as two").toBe(false);
  });

  it("refuses a silent morning dated after today, on the record and in `last_run`", async () => {
    // A morning after today did not happen: nothing was silent on it and no
    // run went through it. Keeping it was worse than useless — a day ahead of
    // today never ages out of the week and is rewritten into the state on
    // every run, so one skewed clock or one edited file reddens each
    // then-unread source at its next single silence, for good (Security
    // review, 2026-09-24).
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const ahead = stateWith({ x: ["2099-01-01"], y: [daysAfter(1)], down: [TODAY] });
    const { nextState } = await runWatch(watching("down"), ahead, fetcher, TODAY);
    expect(nextState.lapses, "a day the calendar has not reached was recorded").toEqual({ down: [TODAY] });

    // The migration's own day is the same day, read by the same rule: a
    // `last_run` after today is no morning to migrate.
    const skewed = {
      entries: {}, last_run: "2099-01-01", unread: [{ id: "down", url: addressOf("down") }],
    } as unknown as WatchState;
    const { nextState: after, verdict } = await runWatch(watching("down"), skewed, fetcher, TODAY);
    expect(after.lapses).toEqual({ down: [TODAY] });
    expect(verdict.red, "a morning that has not happened yet was counted as the first of two").toBe(false);
  });

  it("reads its sources on a state whose unread list is not a list", async () => {
    // `unread` comes off the same file as `lapses`, and the migration walks
    // it on every state now. A field that is not a list threw `is not
    // iterable` before the first source was read — the whole harm the days'
    // own shape check exists to prevent, one field over (Security review,
    // 2026-09-24).
    const { fetcher } = scripted({ [addressOf("down")]: [fail("transient")] });
    const state = { entries: {}, last_run: YESTERDAY, unread: 5 } as unknown as WatchState;
    const { reports, nextState, verdict } = await runWatch(watching("down"), state, fetcher, TODAY);
    expect(reports.map((r) => r.id), "the run read no source at all").toEqual(["down"]);
    // A list that is not a list names no source, so it claims no morning: the
    // source's silence is today's, its first.
    expect(nextState.lapses).toEqual({ down: [TODAY] });
    expect(verdict.lapsed.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.red).toBe(false);

    // And the same field through a targeted pass, which filters the same list.
    const only = watching("down");
    const pass = await runWatch(only, state, fetcher, TODAY);
    expect(mergeTargetedRun(state, pass.nextState, only, TODAY).unread)
      .toEqual([{ id: "down", url: addressOf("down") }]);
  });

  it("migrates the entries of an unread list that are entries, and nothing else on it", async () => {
    // An entry of that list is an id and the page it names — the site is
    // shipped this file and prints both. Anything else on the list is not an
    // unread source and makes no claim that one was silent; `3` used to file
    // a morning under the id `undefined`.
    const { fetcher } = scripted({
      [addressOf("down")]: [fail("transient")],
      [addressOf("x")]: [fail("transient")],
    });
    const state = {
      entries: {}, last_run: YESTERDAY,
      unread: [3, { id: "x" }, { id: "down", url: addressOf("down") }],
    } as unknown as WatchState;
    const { nextState, verdict } = await runWatch(watching("down", "x"), state, fetcher, TODAY);
    expect(nextState.lapses).toEqual({ down: [YESTERDAY, TODAY], x: [TODAY] });
    expect(verdict.outages.map((u) => u.id)).toEqual(["down"]);
    expect(verdict.lapsed.map((u) => u.id), "an entry with no page was read as an unread source").toEqual(["x"]);
  });

  it("counts the migrated morning of a source whose id is a word every object answers to", async () => {
    // The ids are the watchlist's, and the watchlist has no grammar for them:
    // `checkCoverage` asks what an entry's url is, what kind it is and what
    // steps it declares, and never how its id is spelled. So `constructor` is
    // a legal id, and a record keyed by ids must not answer for it before
    // anything was written — the read used to come back non-nullish, the
    // migrated morning was never stored, and the source's next silence was a
    // lapse where the migration meant an outage (Security review,
    // 2026-09-24).
    const { fetcher } = scripted({ [addressOf("constructor")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(
      watching("constructor"), stateWith(undefined, "constructor"), fetcher, TODAY,
    );
    expect(nextState.lapses!["constructor"]).toEqual([YESTERDAY, TODAY]);
    expect(verdict.outages.map((u) => u.id)).toEqual(["constructor"]);
    expect(verdict.red, "a source named after a prototype's own word lost its migrated morning").toBe(true);
  });

  it("writes a source whose id is `__proto__` as a key, and reads it back as one", async () => {
    // The same legality, and the one id that would not merely be read through
    // the prototype but move it: nothing in this repository forbids it, so it
    // is carried as what it is — a key of the record, written into the state
    // file and read out of it like any other id.
    const { fetcher } = scripted({ [addressOf("__proto__")]: [fail("transient")] });
    const { nextState, verdict } = await runWatch(
      watching("__proto__"), stateWith(undefined, "__proto__"), fetcher, TODAY,
    );
    expect(Object.keys(nextState.lapses!)).toEqual(["__proto__"]);
    expect(nextState.lapses!["__proto__"]).toEqual([YESTERDAY, TODAY]);
    expect(verdict.outages.map((u) => u.id)).toEqual(["__proto__"]);

    // And through the file: the state the run writes is JSON, and the morning
    // after reads its days back off it.
    const onDisk = JSON.parse(JSON.stringify(nextState)) as WatchState;
    expect(Object.keys(onDisk.lapses!)).toEqual(["__proto__"]);
    const { fetcher: again } = scripted({ [addressOf("__proto__")]: [fail("transient")] });
    const after = await runWatch(watching("__proto__"), onDisk, again, TOMORROW);
    expect(after.nextState.lapses!["__proto__"]).toEqual([YESTERDAY, TODAY, TOMORROW]);
    expect(after.verdict.outages.map((u) => u.id)).toEqual(["__proto__"]);
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
