import { describe, expect, it } from "vitest";
import {
  runWatch, STRATEGIES,
  checkCoverage, checkQuotes, datasetQuotes, datasetSourceUrls,
  type BrowserReader, type Fetcher, type WatchEntry, type Watchlist, type WatchStep, type WatchStrategy,
} from "../src/watch/core.js";
import { unreadSources, type WatchState } from "../src/watch/state.js";
import type { Dataset } from "../src/types.js";
import { fetchSource } from "../src/watch/fetch-source.js";
import { readFileSync } from "node:fs";

/**
 * s34 — the watch reads the IND itself again.
 *
 * Seven pages whose operative text never reached a `fetch` move to a strategy
 * that opens them in a real browser: the five IND route pages, the Opportunity
 * Card's BMI notice and the Blue Card directive on EUR-Lex. The reading is the
 * page as rendered; from there it is the html strategy exactly, markers and
 * all.
 *
 * These cases are the slice's own promises, and several of them retire an s14
 * promise by name — each says which.
 */

describe("s34 — the browser strategy is html with a different reader", () => {
  it("is a strategy the table knows, and it fetches and compares like html", () => {
    const browser = STRATEGIES["browser" as WatchStrategy];
    expect(browser).toBeDefined();
    expect(browser.fetches).toBe(true);
    expect(browser.compares).toBe(true);
  });

  it("says browser in its own voice when there is no text to check a quote against", () => {
    // Every strategy answers the quote gate for itself; a browser entry that
    // has never been opened must not borrow another strategy's wording, or a
    // curator reading the gate cannot tell which reader failed to run. The
    // decision is that the answers differ, not what any of them says — the
    // wording is a sentence a person reads, and a check keyed to it would be
    // passed by editing the sentence.
    const answers = Object.values(STRATEGIES).map((s) => s.no_text_snapshot);
    expect(new Set(answers).size, "two strategies give the quote gate the same answer").toBe(answers.length);
  });

  it("lets exactly one strategy follow a redirect anywhere, and makes every row say which", () => {
    // The decision, pinned where it is made. `anywhere` is for a strategy
    // that takes no reading — a link — because what a source redirects to is
    // not the source, and bytes an on-path rewrite could have replaced must
    // never be hashed as the authority's. Any new strategy has to choose, and
    // choosing `anywhere` has to be deliberate enough to change this line.
    const anywhere = Object.entries(STRATEGIES)
      .filter(([, how]) => how.redirects === "anywhere")
      .map(([name]) => name);
    expect(anywhere).toEqual(["link"]);
    for (const [name, how] of Object.entries(STRATEGIES))
      expect(["same-origin", "anywhere"], `${name} does not say how far it follows`).toContain(how.redirects);
    // And the one that follows anywhere is the one that never compares.
    expect(STRATEGIES.link.compares).toBe(false);
  });

  it("hands each reader the policy from the table, rather than each keeping its own", () => {
    // The row said one thing and the browser reader did another, so the row
    // was decoration — a change to it changed nothing (Standards review,
    // 2026-09-25).
    const asked: string[] = [];
    const fetcher: Fetcher = async (_url, redirects) => {
      asked.push(`fetch ${redirects}`);
      return { ok: true, body: encode("<p>plain</p>") };
    };
    const browser: BrowserReader = async (_entry, redirects) => {
      asked.push(`browser ${redirects}`);
      return { ok: true, body: encode("<p>rendered</p>") };
    };
    return runWatch(
      { entries: [browserEntry, htmlEntry, { ...htmlEntry, id: "a-link", strategy: "link", kind: "sentinel" }] },
      emptyState, fetcher, "2026-09-25", browser,
    ).then(() => {
      expect(asked).toEqual(["browser same-origin", "fetch same-origin", "fetch anywhere"]);
    });
  });

  it("tells a curator what html tells them: the page's words moved, so the value moves", () => {
    expect(STRATEGIES["browser" as WatchStrategy].remediation).toBe(STRATEGIES.html.remediation);
  });
});

/** A page whose operative text only exists once a script has run. */
const RENDERED = `<!doctype html><html><body>
  <p>Last update: 23 September 2026</p>
  <p>Lede sentence.</p>
  <h2>Requirements</h2>
  <p>You have an employment contract.</p>
  <footer>Cookies Proclaimer</footer>
</body></html>`;

const browserEntry: WatchEntry = {
  id: "fixture-browser",
  url: "https://example.invalid/rendered",
  strategy: "browser",
  kind: "value-source",
  slice: { from: "Lede sentence.", to: "Cookies Proclaimer" },
};

const htmlEntry: WatchEntry = {
  id: "fixture-html",
  url: "https://example.invalid/plain",
  strategy: "html",
  kind: "value-source",
};

const readJson = (name: string) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8").replace(/^﻿/, ""));

const encode = (s: string) => new TextEncoder().encode(s);
const emptyState: WatchState = { entries: {} };
const dataset = readJson("../data/dataset.json") as Dataset;
const refuse: Fetcher = async (url) => ({ ok: false, error: `nothing may fetch ${url}`, failure: "refused-by-us" });

describe("s34 — a browser reading is read exactly as html is", () => {
  const openInBrowser: BrowserReader = async (entry) => {
    expect(entry.id, "the reader is handed the entry, not just its url").toBe("fixture-browser");
    return { ok: true, body: encode(RENDERED) };
  };

  it("baselines the sliced, normalized text of the rendered page", async () => {
    const { reports, nextState } = await runWatch(
      { entries: [browserEntry] }, emptyState, refuse, "2026-09-23", openInBrowser,
    );
    expect(reports[0]!.outcome).toBe("baseline");
    // The snapshot carries text, so the quote gate can check a sentence
    // against it — the promise s14 could not make for these pages.
    expect(nextState.entries["fixture-browser"]!.text)
      .toBe("Lede sentence. Requirements You have an employment contract. Cookies Proclaimer");
  });

  // The contract: s34 point 1 — "a missing marker reported as `unreachable`,
  // never as 'no change'" — and point 2, "makes the entry `unreachable` with
  // the step named in the error". Both are promises about what the run SAYS,
  // so the wording is the contract and the cases below name it.
  it("reports a missing slice marker as unreachable, never as no change", async () => {
    const shell: BrowserReader = async () => ({ ok: true, body: encode("<html><body>Lede sentence.</body></html>") });
    const { reports, nextState } = await runWatch(
      { entries: [browserEntry] }, emptyState, refuse, "2026-09-23", shell,
    );
    expect(reports[0]!.outcome).toBe("unreachable");
    expect(reports[0]!.error).toMatch(/slice marker missing: to/);
    expect(nextState.entries["fixture-browser"]).toBeUndefined();
  });

  it("does not send a browser entry to the fetcher, nor an html entry to the browser", async () => {
    const seen: string[] = [];
    const fetcher: Fetcher = async (url) => { seen.push(`fetch ${url}`); return { ok: true, body: encode("<p>plain</p>") }; };
    const browser: BrowserReader = async (entry) => { seen.push(`browser ${entry.url}`); return { ok: true, body: encode(RENDERED) }; };
    await runWatch({ entries: [browserEntry, htmlEntry] }, emptyState, fetcher, "2026-09-23", browser);
    expect(seen).toEqual(["browser https://example.invalid/rendered", "fetch https://example.invalid/plain"]);
  });
});

describe("s34 — a run with no browser reads the rest and goes red on the seven", () => {
  it("marks exactly the browser entries unreachable, and names the browser it never had", async () => {
    const fetcher: Fetcher = async () => ({ ok: true, body: encode("<p>plain</p>") });
    const { reports, nextState } = await runWatch(
      { entries: [browserEntry, htmlEntry] }, emptyState, fetcher, "2026-09-23",
    );
    expect(reports.map((r) => [r.id, r.outcome])).toEqual([
      ["fixture-browser", "unreachable"],
      ["fixture-html", "baseline"],
    ]);
    expect(reports[0]!.error, "the error does not say a browser was what was missing").toMatch(/browser/);
    // Red, and the html entry still read: a run that cannot open a browser has
    // not read these pages, and must not say it has.
    expect(nextState.unread)
      .toEqual([{ id: "fixture-browser", url: "https://example.invalid/rendered" }]);
    expect(nextState.entries["fixture-html"]).toBeDefined();
  });
});

describe("s34 — a report's url is the key the site looks a source up by", () => {
  it("survives the trip from runWatch into the freshness clause", () => {
    // `report.url` is read by people AND used as the unread list's key, which
    // `unreadSources` looks up against the dataset's own source urls. It is
    // stripped of credentials and nothing else: a shortened or re-normalised
    // url would match nothing there and the source would drop out of the
    // site's freshness sentence without a word (Standards review,
    // 2026-09-25).
    const cited = [...datasetSourceUrls(dataset)];
    const longest = cited.reduce((a, b) => (b.length > a.length ? b : a), "");
    const entryFor = watchlist.entries.find((e) => e.url === longest)!;
    expect(entryFor, "no watch entry for the longest dataset source").toBeDefined();

    return runWatch(
      { entries: [entryFor] }, { entries: {} },
      async () => ({ ok: false, error: "nothing today", failure: "transient" }),
      "2026-09-25",
      async () => ({ ok: false, error: "nothing today", failure: "transient" }),
    ).then(({ nextState }) => {
      expect(nextState.unread?.map((u) => u.url)).toEqual([longest]);
      // And the site can find it: the lookup is by this exact url.
      const withReading: WatchState = {
        ...nextState,
        entries: { [entryFor.id]: { hash: "h", retrieved_at: "2026-09-20", history: [] } },
      };
      expect(unreadSources(dataset, withReading).map((u) => u.id)).toEqual([entryFor.id]);
    });
  });
});

describe("s34 — a watched address may not carry a name and password", () => {
  it("the gate refuses one, and never prints the credentials", () => {
    // Both readers refuse such an address at run time; this refuses it where
    // it is curator data, so it fails at `npm run check` and not on a
    // morning. Nothing this project watches needs credentials, and a watch
    // that sends them is a watch that can leak them.
    const withCredentials: Watchlist = {
      entries: [{
        ...htmlEntry,
        url: "https://watcher:hunter2@example.invalid/rules",
        kind: "sentinel",
      }],
    };
    const gate = checkCoverage(dataset, withCredentials);
    expect(gate.urls_with_credentials.length, "the gate let credentials through").toBe(1);
    expect(gate.ok).toBe(false);
    const said = gate.urls_with_credentials.join(" ");
    expect(said, "the password was printed").not.toContain("hunter2");
    expect(said, "the name was printed").not.toContain("watcher");
    expect(said, "the entry is not named").toContain("fixture-html");
  });

  it("says nothing about the watchlist this repository ships", () => {
    expect(checkCoverage(dataset, watchlist).urls_with_credentials).toEqual([]);
  });

  it("names the entry and not the address when the url is malformed as well", () => {
    // `new URL("://watcher:hunter2@host/")` throws, so the failure branch is
    // the likely way a credentialled address arrives — and it was printing
    // the raw url, which is the one string this check exists to withhold.
    const mangled: Watchlist = {
      entries: [{ ...htmlEntry, url: "://watcher:hunter2@example.invalid/rules", kind: "sentinel" }],
    };
    const said = JSON.stringify(checkCoverage(dataset, mangled));
    expect(said, "the password was printed").not.toContain("hunter2");
    expect(said, "the name was printed").not.toContain("watcher");
  });

  it("refuses a value-source on a strategy that fetches but never compares", () => {
    // Flipping an entry to `link` was silent: the gate stayed empty and `ok`,
    // the run reported `ok` whatever the source now said, the snapshot the
    // quote gate checks against was never refreshed — so the sentence stayed
    // "verified" against a reading nothing renews — and since s34 the entry
    // moved onto the redirect policy written for links, which follows off the
    // site. It should be a decision somebody defends (Security review,
    // 2026-09-25).
    const flipped: Watchlist = {
      entries: [{ ...htmlEntry, id: "flipped", strategy: "link", learn_for: "recognition_de" }],
    };
    const gate = checkCoverage(dataset, flipped);
    expect(gate.unchecked_value_sources.length).toBe(1);
    expect(gate.unchecked_value_sources[0]).toContain("flipped");
    expect(gate.ok).toBe(false);
  });

  it("refuses an entry a dataset value rests on, whatever the entry calls itself", () => {
    // The flip is two words, not one: a `value-source` on `html` becomes a
    // `sentinel` on `link` in a single edit, and every check that keys on
    // `kind` then agrees with it. What does not change is that a shipped
    // sentence rests on that page (Security review, 2026-09-25).
    const cited = [...datasetSourceUrls(dataset)][0]!;
    const flipped: Watchlist = {
      entries: watchlist.entries.map((e) => (e.url === cited
        ? { ...e, strategy: "link" as const, kind: "sentinel" as const, learn_for: "recognition_de" }
        : e)),
    };
    const gate = checkCoverage(dataset, flipped);
    expect(gate.unchecked_value_sources.length, "a cited source was allowed onto a strategy that never compares").toBe(1);
    expect(gate.unchecked_value_sources[0]).toContain(watchlist.entries.find((e) => e.url === cited)!.id);
    expect(gate.ok).toBe(false);
  });

  it("says nothing about the sentinels that legitimately sit there", () => {
    // A learn link is a sentinel: it backs no value, so nothing rests on a
    // reading it never takes.
    expect(checkCoverage(dataset, watchlist).unchecked_value_sources).toEqual([]);
  });

  it("keeps a credentialled entry's password out of every report it makes", async () => {
    // A report travels into a log line, a flag file and the issue that flag
    // becomes. It is sanitised where reports are made, so that no printer
    // downstream has to remember to (Security review, 2026-09-24).
    const credentialled: WatchEntry = {
      ...htmlEntry, id: "credentialled", url: "https://watcher:hunter2@example.invalid/rules",
    };
    const { reports } = await runWatch(
      { entries: [credentialled] }, emptyState,
      async (url, redirects) => fetchSource(url, redirects), "2026-09-24",
    );
    const said = JSON.stringify(reports);
    expect(said, "the password rode in a report").not.toContain("hunter2");
    expect(said, "the name rode in a report").not.toContain("watcher");
    // The report still says which page it is about.
    expect(reports[0]!.url).toContain("example.invalid/rules");
    expect(reports[0]!.outcome).toBe("unreachable");
  });
});

describe("s34 — one bad source does not take the pass down with it", () => {
  it("reports a malformed entry url as unreachable and reads the rest", async () => {
    // `runWatch` promises that a mangled source is one `unreachable` and not
    // the end of the pass, and the fetcher broke that promise for a while by
    // parsing the url outside its own try: the throw escaped `runWatch`, so
    // there were no reports, no state and no flags for any of the other
    // forty-four sources either (Standards review, 2026-09-24).
    const mangled: WatchEntry = { ...htmlEntry, id: "mangled", url: "not-an-address" };
    const good: Fetcher = async () => ({ ok: true, body: encode("<p>the authority's words</p>") });
    const { reports, nextState } = await runWatch(
      { entries: [mangled, htmlEntry] }, emptyState,
      async (url, redirects) => (url === "not-an-address" ? fetchSource(url, redirects) : good(url, redirects)),
      "2026-09-24",
    );
    expect(reports.map((r) => [r.id, r.outcome])).toEqual([
      ["mangled", "unreachable"],
      ["fixture-html", "baseline"],
    ]);
    expect(nextState.entries["fixture-html"], "the good source went unread too").toBeDefined();
  });
});

describe("s34 — the steps are data in a closed vocabulary the validator checks", () => {
  const watched = (steps: unknown): Watchlist => ({
    entries: [{ ...browserEntry, url: "https://example.invalid/unwatched", kind: "sentinel", steps } as WatchEntry],
  });

  it("accepts each of the four steps the vocabulary defines", () => {
    const every: WatchStep[] = [
      { step: "select", field: "What is your nationality?", option: "Türkiye" },
      { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
      { step: "press", button: "View information" },
      { step: "expand" },
    ];
    expect(checkCoverage(dataset, watched(every)).invalid_steps).toEqual([]);
  });

  it("refuses a step whose name is not in the vocabulary", () => {
    const refused = checkCoverage(dataset, watched([{ step: "scroll" }])).invalid_steps;
    expect(refused.length).toBe(1);
    expect(refused[0]).toMatch(/scroll/);
    expect(checkCoverage(dataset, watched([{ step: "scroll" }])).ok).toBe(false);
  });

  it("refuses a step of a known name that is missing the label it acts on", () => {
    // A `press` with no button names nothing, so nothing can be pressed and
    // nothing can be reported missing either — it would read as a step that
    // silently did nothing.
    expect(checkCoverage(dataset, watched([{ step: "press" }])).invalid_steps.length).toBe(1);
    expect(checkCoverage(dataset, watched([{ step: "select", field: "x" }])).invalid_steps.length).toBe(1);
    expect(checkCoverage(dataset, watched([{ step: "answer", question: "x", answer: "maybe" }])).invalid_steps.length).toBe(1);
  });

  it("refuses steps on a strategy that opens no browser", () => {
    const onHtml = checkCoverage(dataset, {
      entries: [{ ...htmlEntry, url: "https://example.invalid/unwatched", kind: "sentinel", steps: [{ step: "expand" }] }],
    });
    expect(onHtml.invalid_steps.length).toBe(1);
    expect(onHtml.invalid_steps[0]).toMatch(/html/);
  });
});

/** The seven that move, and the sentence count each one takes off the tier. */
const MOVED = [
  "nl-ind-highly-skilled-migrant",
  "nl-ind-orientation-year",
  "nl-ind-blue-card",
  "nl-ind-ict",
  "nl-ind-researcher",
  "de-bmi-chancenkarte",
  "eur-lex-blue-card-directive",
];

/** The five whose requirements render behind the IND's "Your situation" form. */
const FORM_WALLED = [
  "nl-ind-highly-skilled-migrant",
  "nl-ind-orientation-year",
  "nl-ind-blue-card",
  "nl-ind-ict",
  "nl-ind-researcher",
];

/** The two the browser does not reach: a challenge it fails, and a geography. */
const STAY_HUMAN = ["legifrance-ce-algerian-titles", "gesetze-official-recheck"];

const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const entryOf = (id: string) => watchlist.entries.find((e) => e.id === id)!;

describe("s34 — seven entries move to the browser and two stay with a person", () => {
  it("each of the seven is a browser entry with a slice, a history line and no verification age", () => {
    // RETIRES s14's "each takes the human strategy, a quarterly age and a read
    // date, and loses its slice" for the five IND pages, and s29's equivalent
    // for the Opportunity Card's notice. The two bot-gated cases of s14 keep
    // Legifrance; EUR-Lex moves here.
    for (const id of MOVED) {
      const entry = entryOf(id);
      expect(entry, id).toBeDefined();
      expect(entry.strategy, id).toBe("browser");
      // A page read by a machine has no verification age and no read date:
      // those are the human tier's, and this entry has left it.
      expect(entry.max_age_days, `${id}: a machine-read entry carries a verification age`).toBeUndefined();
      expect(entry.last_verified, `${id}: a machine-read entry carries a human read date`).toBeUndefined();
      // A slice, because every one of these pages carries furniture that moves
      // on its own — a maintenance banner, a press teaser, fifty other articles.
      expect(entry.slice, `${id}: no slice`).toBeDefined();
      expect(entry.history?.some((h) => h.changed_at === "2026-09-23"), `${id}: no history line for this slice`).toBe(true);
    }
  });

  it("the five form-walled pages carry the recipe a person follows, as steps", () => {
    // s5e §3's "How to reach the requirements", in the vocabulary: the
    // nationality, the two permit questions, the button, and the blocks a
    // person opens. The other two browser entries need none — nothing on them
    // has to be answered, only rendered.
    for (const id of FORM_WALLED) {
      const steps = entryOf(id).steps ?? [];
      expect(steps.map((s) => s.step), id).toEqual(["select", "answer", "answer", "press", "expand"]);
      // "Turkish", not "Türkiye": the IND's nationality list holds adjectives,
      // read in a real browser on 2026-09-23 after the runner's typing found
      // no match for the country's name.
      expect(steps[0], id).toMatchObject({ field: "What is your nationality?", option: "Turkish" });
      expect(steps.filter((s) => s.step === "answer").every((s) => s.answer === "no"), id).toBe(true);
      expect(steps[3], id).toMatchObject({ button: "View information" });
    }
    for (const id of ["de-bmi-chancenkarte", "eur-lex-blue-card-directive"])
      expect(entryOf(id).steps, `${id}: a page that renders itself carries steps`).toBeUndefined();
  });

  it("every declared step is in the vocabulary, on every entry in the watchlist", () => {
    expect(checkCoverage(dataset, watchlist).invalid_steps).toEqual([]);
  });

  it("the two that stay say, with this day's date, why the browser does not reach them", () => {
    for (const id of STAY_HUMAN) {
      const entry = entryOf(id);
      expect(entry.strategy, id).toBe("human");
      expect(entry.max_age_days, id).toBe(90);
      expect(entry.note, `${id}: the note does not re-state the reason on this slice's day`).toMatch(/2026-09-23/);
    }
  });

  it("leaves exactly those two on the human tier", () => {
    const human = watchlist.entries.filter((e) => e.strategy === "human").map((e) => e.id).sort();
    expect(human).toEqual([...STAY_HUMAN].sort());
  });
});

describe("s34 — the quote gate reads the seven", () => {
  const state = readJson("../watch/state.json") as WatchState;
  const sevenUrls = new Set(MOVED.map((id) => entryOf(id).url));
  const onTheSeven = datasetQuotes(dataset).filter((q) => sevenUrls.has(q.source_url));

  it("counts, from the dataset, the thirty-nine sentences the seven were carrying", () => {
    // 38 on the five IND pages (12 + 8 + 7 + 6 + 5, the count s14 established
    // and this slice inherits) and 1 on EUR-Lex, Article 3(1). The BMI notice
    // is a sentinel and backs none — which is why 39 and not 40: the fortieth
    // quote on the old tier was Legifrance's, and it stays.
    expect(onTheSeven.length).toBe(39);
  });

  it("the state carries a text snapshot for each of the seven, and the quote gate reads it", () => {
    // REPLACES s14's "represents the five the way it represents every
    // human-tier entry: absent" and "the state carries no stale IND snapshot".
    for (const id of MOVED) {
      const snapshot = state.entries[id];
      expect(snapshot, `${id}: no snapshot`).toBeDefined();
      expect(snapshot!.text, `${id}: a browser snapshot with no text`).toBeTruthy();
      // The slice it was read through travels with it, so a moved marker is
      // recognisable as our own edit rather than the authority's.
      expect(snapshot!.slice_read, `${id}: no record of the slice it was read through`).toBeTruthy();
    }
  });

  it("human_tier falls to one and nothing is missing", () => {
    // REPLACES s14's "the unverifiable set is exactly the form-gated quotes
    // plus the two bot-gated ones" and "verified drops by exactly what the
    // stale snapshots had been vouching for". The number the check prints as
    // `human_tier` is this length.
    const result = checkQuotes(dataset, watchlist, state);
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.unverifiable.map((u) => u.source_url))
      .toEqual([entryOf("legifrance-ce-algerian-titles").url]);
  });

  it("every one of the thirty-nine is verified against a rendered page, not merely not-missing", () => {
    const result = checkQuotes(dataset, watchlist, state);
    const stillUnverifiable = result.unverifiable.filter((u) => sevenUrls.has(u.source_url));
    expect(stillUnverifiable).toEqual([]);
    // And they are counted: `verified` covers all of them plus everything the
    // html and pdf-text arms already vouched for.
    expect(result.verified).toBeGreaterThanOrEqual(onTheSeven.length);
  });
});

describe("s34 — no slice of the five can match the form the runner is served", () => {
  /**
   * The shell as GitHub's runner rendered it on 2026-09-23 — the *Your
   * situation* form and none of the quoted sentences.
   *
   * It is here because of what happened when it was not. The five entries'
   * markers were the page's own lede and its footer, and the shell carries
   * BOTH: the runner sliced 892 characters of form out of it, hashed them, and
   * recorded a clean baseline for a page whose every quoted sentence was
   * absent. A read that reaches the wrong page must go red, and the only thing
   * standing between those two outcomes is whether a marker can match a shell.
   */
  const shells = readJson("./fixtures/ind-form-shell.json") as {
    entries: Record<string, string>;
  };

  it("keeps the shell that caused this, so the check has something to fail against", () => {
    expect(Object.keys(shells.entries).sort()).toEqual([...FORM_WALLED].sort());
    for (const [id, text] of Object.entries(shells.entries)) {
      expect(text, `${id}: the fixture is not the form`).toMatch(/Your situation/);
      expect(text, `${id}: the fixture already carries requirements`).not.toMatch(/Requirements/);
    }
  });

  it("no marker of the five is anywhere in its own page's shell", () => {
    for (const id of FORM_WALLED) {
      const slice = entryOf(id).slice!;
      const shell = shells.entries[id]!;
      expect(shell.includes(slice.from), `${id}: the slice's FROM marker matches the form shell`).toBe(false);
    }
  });

  it("so a run served the shell reports unreachable, and writes nothing", async () => {
    // The whole point, end to end: the same entries, handed the shell, produce
    // five unreachable and five absent snapshots — not five baselines.
    const asShell: BrowserReader = async (entry) =>
      ({ ok: true, body: encode(`<html><body>${shells.entries[entry.id]}</body></html>`) });
    const five: Watchlist = { entries: FORM_WALLED.map(entryOf) };
    const { reports, nextState } = await runWatch(five, emptyState, refuse, "2026-09-23", asShell);
    expect(reports.map((r) => r.outcome)).toEqual(FORM_WALLED.map(() => "unreachable"));
    for (const r of reports) expect(r.error, r.id).toMatch(/slice marker missing: from/);
    for (const id of FORM_WALLED) expect(nextState.entries[id], id).toBeUndefined();
  });
});
