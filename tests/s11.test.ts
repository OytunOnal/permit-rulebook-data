import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mergeTargetedRun, runWatch, type Fetcher, type Watchlist } from "../src/watch/core.js";
import {
  unreadClause, unreadNeverRead, unreadSentence, unreadSources,
  type UnreadSource, type Snapshot, type WatchState,
} from "../src/watch/state.js";
import { countryAdjective } from "../src/countries.js";
import type { Dataset } from "../src/types.js";

/**
 * s11 — a partial run says so.
 *
 * The watch commits its state before the unreachable check fails the run, on
 * purpose: 42 fresh sources reaching the site beats none. What nobody foresaw
 * is what the site then says — "Every source is re-read daily" was true of 42
 * of them and false of two, and the two backed values on live pages.
 *
 * These cases are about the fact behind that sentence: which sources the last
 * run did not read, what they back, and the day the reading a reader is
 * looking at was actually taken.
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const shippedState = JSON.parse(readFileSync(new URL("../watch/state.json", import.meta.url), "utf8")) as WatchState;
const shippedWatchlist = JSON.parse(
  readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;

/** Spain's salary-threshold PDF — five dataset values rest on it. */
const UMBRAL = "https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf";
/** The UGE requirements page: a sentinel. No dataset value cites it. */
const UGE_INDEX = "https://www.inclusion.gob.es/web/unidadgrandesempresas/autorizaciones-y-requisitos";
/** Two Dutch pages, each backing values on Dutch routes. */
const ORIENTATION = "https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year";
const NL_BLUE_CARD = "https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit";
/** A German one. */
const FACHKRAFT = "https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Arbeit/Fachkraft/fachkraft-node.html";

const LAST_RUN = "2026-09-15";

const snapshot = (retrieved_at: string): Snapshot => ({ hash: "h", retrieved_at, history: [] });

/**
 * A state the way a run leaves it: every entry carries the reading that still
 * stands, and the run says which sources it asked for and did not get.
 */
function stateWith(unread: { id: string; url: string; read: string }[], others: Record<string, string> = {}): WatchState {
  const entries: Record<string, Snapshot> = {};
  for (const [id, day] of Object.entries(others)) entries[id] = snapshot(day);
  for (const u of unread) entries[u.id] = snapshot(u.read);
  return {
    entries,
    last_run: LAST_RUN,
    unread: unread.map((u) => ({ id: u.id, url: u.url })),
  };
}

describe("the sources the last run did not read", () => {
  it("names the entry, its page, the day its reading was taken and the country it backs", () => {
    const state = stateWith([{ id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" }]);
    expect(unreadSources(dataset, state)).toEqual<UnreadSource[]>([
      { id: "es-uge-umbral-pdf", url: UMBRAL, last_read: "2026-09-07", countries: ["ES"] },
    ]);
  });

  it("says nothing at all on a day every source answered", () => {
    const state = stateWith([], { "es-uge-umbral-pdf": "2026-09-07" });
    expect(unreadSources(dataset, state)).toEqual([]);
    expect(unreadSentence(unreadSources(dataset, state))).toBe("");
  });

  it("says nothing for a state no run has written an unread list into", () => {
    // The field is optional, and a state that predates it makes no claim
    // either way. Silence beats inventing 39 unread sources out of a schema.
    const state: WatchState = { entries: { "es-uge-umbral-pdf": snapshot("2026-09-07") }, last_run: LAST_RUN };
    expect(unreadSources(dataset, state)).toEqual([]);
  });

  it("drops a source no dataset value cites — the reader is told about values, not about our plumbing", () => {
    const state = stateWith([{ id: "es-uge-index", url: UGE_INDEX, read: "2026-09-02" }]);
    expect(unreadSources(dataset, state)).toEqual([]);
    expect(unreadSentence(unreadSources(dataset, state))).toBe("");
  });

  it("dates the sentence from the sources, oldest first — never from the run", () => {
    const state = stateWith([
      { id: "nl-ind-orientation-year", url: ORIENTATION, read: "2026-09-11" },
      { id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" },
    ]);
    const sentence = unreadSentence(unreadSources(dataset, state));
    expect(sentence).toContain("since 2026-09-07");
    expect(sentence).not.toContain(LAST_RUN);
  });
});

describe("the exception clause, in the shapes it has to read in", () => {
  const sentenceFor = (unread: { id: string; url: string; read: string }[]) =>
    unreadSentence(unreadSources(dataset, stateWith(unread)));

  it("one country, two sources", () => {
    expect(sentenceFor([
      { id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" },
      { id: "boe-ley-14-2013", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2013-10074", read: "2026-09-09" },
    ])).toBe("Two Spanish sources have not answered since 2026-09-07; the values they back still show that date.");
  });

  it("one country, one source", () => {
    expect(sentenceFor([{ id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" }]))
      .toBe("A Spanish source has not answered since 2026-09-07; the values it backs still show that date.");
  });

  it("two countries, one source each", () => {
    expect(sentenceFor([
      { id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" },
      { id: "nl-ind-orientation-year", url: ORIENTATION, read: "2026-09-11" },
    ])).toBe("A Spanish and a Dutch source have not answered since 2026-09-07; the values they back still show that date.");
  });

  it("two countries, more than one source in one of them", () => {
    expect(sentenceFor([
      { id: "nl-ind-orientation-year", url: ORIENTATION, read: "2026-09-04" },
      { id: "nl-ind-blue-card", url: NL_BLUE_CARD, read: "2026-09-07" },
      { id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-11" },
    ])).toBe("Two Dutch and a Spanish source have not answered since 2026-09-04; the values they back still show that date.");
  });

  it("three countries read as a list", () => {
    expect(sentenceFor([
      { id: "bamf-fachkraft", url: FACHKRAFT, read: "2026-09-02" },
      { id: "nl-ind-orientation-year", url: ORIENTATION, read: "2026-09-04" },
      { id: "nl-ind-blue-card", url: NL_BLUE_CARD, read: "2026-09-05" },
      { id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-11" },
    ])).toBe("A German, two Dutch and a Spanish source have not answered since 2026-09-02; "
      + "the values they back still show that date.");
  });

  it("none of them citable to a country: nothing is said", () => {
    expect(sentenceFor([{ id: "es-uge-index", url: UGE_INDEX, read: "2026-09-02" }])).toBe("");
  });

  it("every country the dataset ships routes for can be named in that sentence", () => {
    for (const country of dataset.countries)
      expect(countryAdjective(country.code), country.code).toBeTruthy();
  });
});

describe("what the run has to write down", () => {
  const entry = (id: string, url: string) => ({
    id, url, strategy: "html" as const, kind: "value-source" as const,
  });
  const watchlist: Watchlist = { entries: [entry("es-uge-umbral-pdf", UMBRAL), entry("bamf-fachkraft", FACHKRAFT)] };
  const body = new TextEncoder().encode("<p>the page, unchanged</p>");
  const refusesSpain: Fetcher = async (url) =>
    url === UMBRAL ? { ok: false, status: 403, error: "HTTP 403" } : { ok: true, body };

  it("records what it could not read, by id and by page", async () => {
    const before = await runWatch(watchlist, { entries: {} }, async () => ({ ok: true, body }), "2026-09-07");
    const { nextState } = await runWatch(watchlist, before.nextState, refusesSpain, LAST_RUN);
    expect(nextState.unread).toEqual([{ id: "es-uge-umbral-pdf", url: UMBRAL }]);
    expect(nextState.last_run).toBe(LAST_RUN);
  });

  it("and writes an empty list on a day nothing refused, so the state states the fact either way", async () => {
    const before = await runWatch(watchlist, { entries: {} }, async () => ({ ok: true, body }), "2026-09-07");
    const { nextState } = await runWatch(watchlist, before.nextState, async () => ({ ok: true, body }), LAST_RUN);
    expect(nextState.unread).toEqual([]);
  });

  /**
   * The evidence for why the run has to say it.
   *
   * s11 was specified on the belief that an entry whose `retrieved_at` predates
   * `last_run` was not read in that run, so the fact was already on disk. It is
   * not: a source that answered and did not change keeps the date its CURRENT
   * reading was first taken (`runWatch`, the `unchanged` arm), which is the
   * same thing an unreachable source leaves behind. The two are indistinguishable
   * in the file.
   */
  it("an older retrieved_at is not evidence of anything: an unchanged page keeps its date too", async () => {
    const first = await runWatch(watchlist, { entries: {} }, async () => ({ ok: true, body }), "2026-09-07");
    const { nextState } = await runWatch(watchlist, first.nextState, refusesSpain, LAST_RUN);
    // One source refused the run; the other answered it. Both snapshots read
    // 2026-09-07 on 2026-09-15.
    expect(nextState.entries["es-uge-umbral-pdf"]!.retrieved_at).toBe("2026-09-07");
    expect(nextState.entries["bamf-fachkraft"]!.retrieved_at).toBe("2026-09-07");
  });
});

describe("the state this repository ships today", () => {
  it("carries entries whose retrieved_at predates the last run far beyond any that went unread", () => {
    // The measurement that corrected the spec, kept as a case: on the shipped
    // state EVERY entry predates `last_run`, because none of them changed on
    // the day they were last read. A derivation keyed on that would have
    // reported the whole watchlist as unread.
    const older = Object.values(shippedState.entries)
      .filter((s) => shippedState.last_run !== undefined && s.retrieved_at < shippedState.last_run);
    expect(older.length).toBeGreaterThan(2);
  });

  it("reports exactly what the run recorded, and nothing it cannot stand behind", () => {
    const watched = new Map(shippedWatchlist.entries.map((e) => [e.id, e.url]));
    for (const source of unreadSources(dataset, shippedState)) {
      expect(watched.get(source.id), source.id).toBe(source.url);
      expect(source.countries.length, source.id).toBeGreaterThan(0);
      expect(source.last_read <= (shippedState.last_run ?? ""), source.id).toBe(true);
    }
  });
});

describe("a targeted re-baseline, which is not a run", () => {
  const list = (...ids: string[]): Watchlist => ({
    entries: ids.map((id) => ({
      id, url: id === "es-uge-umbral-pdf" ? UMBRAL : FACHKRAFT,
      strategy: "html" as const, kind: "value-source" as const,
    })),
  });

  /**
   * `npm run watch:sources -- --only=<entry-id>` is the step CONTRIBUTING
   * documents for re-baselining an entry whose slice a curator moved. The pass
   * fetches that source and nothing else — so the day the last FULL run wrote
   * stands, and so does everything it said about the sources this pass never
   * asked for. What cannot stand is its verdict on the one it just read.
   */
  it("drops the entry it has just read from the unread list", () => {
    const previous = stateWith([{ id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" }],
      { "bamf-fachkraft": "2026-09-02" });
    const pass: WatchState = {
      entries: { "es-uge-umbral-pdf": snapshot("2026-09-16") }, last_run: "2026-09-16", unread: [],
    };
    const merged = mergeTargetedRun(previous, pass, list("es-uge-umbral-pdf"));
    expect(merged.unread).toEqual([]);
    expect(merged.last_run).toBe(LAST_RUN);
    // The lie this exists to prevent, in the words the page would have used.
    expect(unreadSentence(unreadSources(dataset, merged))).toBe("");
  });

  it("keeps what the last run said about every source it did not fetch", () => {
    const previous = stateWith([{ id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" }],
      { "bamf-fachkraft": "2026-09-02" });
    const pass: WatchState = {
      entries: { "bamf-fachkraft": snapshot("2026-09-16") }, last_run: "2026-09-16", unread: [],
    };
    const merged = mergeTargetedRun(previous, pass, list("bamf-fachkraft"));
    expect(merged.unread).toEqual([{ id: "es-uge-umbral-pdf", url: UMBRAL }]);
    expect(unreadSentence(unreadSources(dataset, merged)))
      .toBe("A Spanish source has not answered since 2026-09-07; the values it backs still show that date.");
  });

  it("adds the entry it could not read, and leaves a state that never had a list without one", () => {
    const previous: WatchState = { entries: { "bamf-fachkraft": snapshot("2026-09-02") }, last_run: LAST_RUN };
    const clean = mergeTargetedRun(previous, {
      entries: { "bamf-fachkraft": snapshot("2026-09-16") }, last_run: "2026-09-16", unread: [],
    }, list("bamf-fachkraft"));
    expect(clean.unread, "an empty list is a claim about a pass that made none").toBeUndefined();

    const refused = mergeTargetedRun(previous, {
      entries: {}, last_run: "2026-09-16", unread: [{ id: "bamf-fachkraft", url: FACHKRAFT }],
    }, list("bamf-fachkraft"));
    expect(refused.unread).toEqual([{ id: "bamf-fachkraft", url: FACHKRAFT }]);
  });
});

describe("what the sentence refuses to do", () => {
  it("never puts an id where a reader expects a country", () => {
    // CONTRIBUTING §8: no fallback to an id in prose. A country with no
    // adjective stops the build instead of shipping "a ES source".
    const nowhere = { ...dataset, countries: [{ code: "ZZ", name: "Nowhere", routes: [] }] } as Dataset;
    const sources: UnreadSource[] = [{ id: "x", url: UMBRAL, last_read: "2026-09-07", countries: ["ZZ"] }];
    expect(() => unreadSentence(sources)).toThrow(/ZZ has no adjective/);
    expect(nowhere.countries[0]!.code).toBe("ZZ");
  });

  it("hands the date over separately, so a page can mark it up", () => {
    const sources = unreadSources(dataset, stateWith([{ id: "es-uge-umbral-pdf", url: UMBRAL, read: "2026-09-07" }]));
    const clause = unreadClause(sources)!;
    expect(clause.since).toBe("2026-09-07");
    expect(clause.before).toBe("A Spanish source has not answered since ");
    expect(clause.after).toBe("; the values it backs still show that date.");
    expect(`${clause.before}${clause.since}${clause.after}`).toBe(unreadSentence(sources));
    expect(unreadClause([])).toBeUndefined();
  });

  it("a source it could not read and has never read is counted, not swallowed", () => {
    // No snapshot means no day to have not answered since, so the sentence
    // cannot hold it — but `npm run check` prints it, and this is the case
    // that says where it went.
    const state: WatchState = { entries: {}, last_run: LAST_RUN, unread: [{ id: "es-uge-umbral-pdf", url: UMBRAL }] };
    expect(unreadSources(dataset, state)).toEqual([]);
    expect(unreadNeverRead(dataset, state)).toEqual([{ id: "es-uge-umbral-pdf", url: UMBRAL }]);
    // A sentinel backs no value and is not reported by either.
    expect(unreadNeverRead(dataset, { entries: {}, unread: [{ id: "es-uge-index", url: UGE_INDEX }] })).toEqual([]);
  });
});
