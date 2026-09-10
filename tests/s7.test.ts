import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  carveOutFor, bindsReader, datasetMeta, evaluate, resultProvenance, routeProvenance, routeStatements,
  statementSources,
} from "../src/engine.js";
import { proseProvenance, quotedWithoutProvenance } from "../src/prose.js";
import { scopeLine, statedNotAsked } from "../src/scope.js";
import { validateDataset } from "../src/validate.js";
import {
  checkCoverage, checkQuotes, datasetQuotes, datasetSourceUrls, sliceFingerprint,
  type WatchState, type Watchlist,
} from "../src/watch/core.js";
import type { Dataset, Profile, Route, RouteStatement } from "../src/types.js";

const readJson = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8").replace(/^﻿/, ""));

const dataset = readJson("../data/dataset.json") as Dataset;
const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const state = readJson("../watch/state.json") as WatchState;

const routes = (): Route[] => dataset.countries.flatMap((c) => c.routes);
const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;
const clone = (): Dataset => structuredClone(dataset);

const statementOf = (route: string, id: string): RouteStatement =>
  routeStatements(routeOf(route)).find((s) => s.id === id)!;

/** The three routes the IND's own carve-out names, by naming their permits. */
const SPONSORED = [
  { route: "nl-hsm-30plus", statement: "employer-must-be-a-recognised-sponsor" },
  { route: "nl-hsm-under30", statement: "employer-must-be-a-recognised-sponsor" },
  { route: "nl-researcher", statement: "the-institute-must-be-a-recognised-sponsor" },
] as const;

const DUTCH_ROUTES = [
  "nl-hsm-30plus", "nl-hsm-under30", "nl-blue-card", "nl-ict", "nl-researcher",
  "nl-orientation-year",
] as const;

const TURKISH_SOURCE = "https://ind.nl/en/turkish-citizens-and-living-in-the-netherlands";
const MVV_SOURCE = "https://ind.nl/en/mvv-exemptions";

const turkish: Profile = { destination: "nl", citizenship: "TR" };
const japanese: Profile = { destination: "nl", citizenship: "JP" };

/**
 * s7 — "A statement can name the nationalities it does not bind".
 *
 * `citizenship` was used in exactly one way in all 23 routes — `eq
 * third_country` — so no route COULD say "for nationals of X this does not
 * apply", even where the authority says exactly that. The product asked which
 * passport a reader would apply with and then scored them against conditions
 * the IND itself sets aside for that passport (found by the human on the live
 * site, diagnosed as a class in issue #8).
 */
describe("s7 — a carve-out names the passports a statement does not bind", () => {
  it("releases a Turkish passport from the recognised-sponsor condition, on the three permits the IND names", () => {
    for (const { route, statement } of SPONSORED) {
      const s = statementOf(route, statement);
      expect(s.except?.citizenship, `${route}:${statement}`).toEqual(["TR"]);
      expect(bindsReader(s, turkish), `${route}:${statement}`).toBe(false);
      expect(carveOutFor(s, turkish)?.source.source_url, route).toBe(TURKISH_SOURCE);
      // Not asked, not stated: the sentence leaves the conditions this reader
      // is told about, and the carve-out is what stands in its place.
      expect(statedNotAsked(routeOf(route), { profile: turkish }), route).not.toContain(s.text);
    }
  });

  it("keeps the recognised-sponsor condition for every other passport", () => {
    for (const { route, statement } of SPONSORED) {
      const s = statementOf(route, statement);
      expect(bindsReader(s, japanese), route).toBe(true);
      expect(carveOutFor(s, japanese), route).toBeUndefined();
      expect(statedNotAsked(routeOf(route), { profile: japanese }), route).toContain(s.text);
      // A reader who has not said which passport yet is bound by everything:
      // a carve-out releases a declared passport, never a silence.
      expect(statedNotAsked(routeOf(route)), route).toContain(s.text);
    }
  });

  it("leaves the Blue Card and the intra-corporate transferee alone — their pages never name Turkish citizens", () => {
    for (const id of ["nl-blue-card", "nl-ict"])
      for (const s of routeStatements(routeOf(id)))
        expect(s.except?.source.source_url, `${id}:${s.id}`).not.toBe(TURKISH_SOURCE);
  });

  it("states the provisional residence permit on every Dutch route, and exempts the ten passports the IND lists", () => {
    for (const id of DUTCH_ROUTES) {
      const mvv = statementOf(id, "mvv-needed");
      // A requirement: it fails nobody by itself, but it is a bar to clear, so
      // it is stated under "Also required" (Standards review, 2026-09-10).
      expect(mvv.kind, id).toBe("precondition");
      // The requirement is quoted from the route's OWN page, never borrowed
      // from a neighbour: each page states it in its own words.
      expect(mvv.source?.source_url, id).toBe(routeOf(id).info_url);
      expect([...(mvv.except?.citizenship ?? [])].sort(), id)
        .toEqual(["AU", "CA", "CH", "GB", "JP", "KR", "MC", "NZ", "US", "VA"]);
      expect(mvv.except?.source.source_url, id).toBe(MVV_SOURCE);
      // Turkey is not on the IND's exemption list, so the requirement stands.
      expect(bindsReader(mvv, turkish), id).toBe(true);
      expect(bindsReader(mvv, japanese), id).toBe(false);
      expect(statedNotAsked(routeOf(id), { profile: turkish }), id).toContain(mvv.text);
      expect(statedNotAsked(routeOf(id), { profile: japanese }), id).not.toContain(mvv.text);
    }
  });

  it("counts a condition that does not bind this reader out of the scope line", () => {
    const route = routeOf("nl-researcher");
    // An Indian passport is on neither list, so every condition binds it.
    const indian: Profile = { destination: "nl", citizenship: "IN" };
    const bound = statedNotAsked(route, { split: true, profile: indian });
    const released = statedNotAsked(route, { split: true, profile: turkish });
    // One sentence apart: the recognised-sponsor condition.
    expect(released.stated.length).toBe(bound.stated.length - 1);
    expect(scopeLine(route, turkish)).not.toBe(scopeLine(route, indian));
    // A page with no reader states everything, and its line is the bound one.
    expect(scopeLine(route)).toBe(scopeLine(route, indian));
  });
});

describe("s7 — a carve-out we cannot quote is a carve-out we do not ship", () => {
  const withExcept = (patch: Record<string, unknown>): Dataset => {
    const ds = clone();
    const route = ds.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-ict")!;
    route.statements![0].except = patch as unknown as RouteStatement["except"];
    return ds;
  };

  const good = {
    citizenship: ["JP"],
    text: "Not required for a Japanese passport.",
    source: { source_url: "https://ind.nl/en/mvv-exemptions", quote: "Japan", retrieved_at: "2026-09-10" },
  };

  it("accepts one that carries its passports, its words and its quote", () => {
    expect(validateDataset(withExcept(good)).ok).toBe(true);
  });

  it("refuses one with no source — `unsourced` is not an answer here", () => {
    const { source: _dropped, ...noSource } = good;
    expect(validateDataset(withExcept(noSource)).ok).toBe(false);
    expect(validateDataset(withExcept({
      ...noSource, unsourced: { reason: "unreachable", checked_at: "2026-09-10" },
    })).ok).toBe(false);
  });

  it("refuses an empty passport list, and a carve-out with nothing to say", () => {
    expect(validateDataset(withExcept({ ...good, citizenship: [] })).ok).toBe(false);
    expect(validateDataset(withExcept({ ...good, text: "" })).ok).toBe(false);
  });

  it("refuses a passport the citizenship question cannot answer", () => {
    const result = validateDataset(withExcept({ ...good, citizenship: ["JP", "schengen_only"] }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toContain("schengen_only");
  });
});

describe("s7 — a carve-out is watched and quote-checked like every other value", () => {
  it("puts both new sources on the watchlist, each sliced to the section its quote comes from", () => {
    const urls = datasetSourceUrls(dataset);
    expect(urls.has(TURKISH_SOURCE)).toBe(true);
    expect(urls.has(MVV_SOURCE)).toBe(true);
    for (const id of ["ind-turkish-citizens", "ind-mvv-exemptions"]) {
      const entry = watchlist.entries.find((e) => e.id === id)!;
      expect(entry, id).toBeDefined();
      expect(entry.slice, id).toBeDefined();
      // The watch rule written on 2026-09-09: a commit that adds or moves a
      // slice re-reads that entry's baseline in the same change, or the next
      // run files our own edit as the authority's.
      expect(state.entries[id], id).toBeDefined();
      expect(state.entries[id].slice_read, id).toBe(sliceFingerprint(entry));
    }
    expect(checkCoverage(dataset, watchlist).ok).toBe(true);
  });

  it("checks the carve-out's sentence against the page it cites", () => {
    const quotes = datasetQuotes(dataset);
    for (const url of [TURKISH_SOURCE, MVV_SOURCE])
      expect(quotes.filter((q) => q.source_url === url).length, url).toBeGreaterThan(0);
    const result = checkQuotes(dataset, watchlist, state);
    expect(result.missing).toEqual([]);
  });

  it("shows the carve-out's quote on the card and on the route page", () => {
    const route = routeOf("nl-researcher");
    const sponsor = statementOf("nl-researcher", "the-institute-must-be-a-recognised-sponsor");
    expect(statementSources(sponsor).map((v) => v.source_url))
      .toEqual([route.info_url, TURKISH_SOURCE]);
    // A route page has no reader and rules on nobody, so it holds both halves.
    expect(routeProvenance(route).map((e) => e.value.source_url)).toContain(TURKISH_SOURCE);
    // A card follows what the card shows: the carve-out's sentence in place of
    // the condition's, for the reader it releases.
    const result = evaluate(dataset, turkish).find((r) => r.route.id === "nl-researcher")!;
    const quotes = resultProvenance(result, turkish).map((e) => e.value.quote);
    expect(quotes).toContain(sponsor.except!.source.quote);
    expect(quotes).not.toContain(sponsor.source!.quote);
    // And for a reader it does not release, the condition's own words stand
    // and the carve-out's are not theirs to read.
    const other = resultProvenance(result, { citizenship: "IN" }).map((e) => e.value.quote);
    expect(other).toContain(sponsor.source!.quote);
    expect(other).not.toContain(sponsor.except!.source.quote);
  });

  it("counts the carve-out's sentence among the ones an authority is shown to have said", () => {
    expect(quotedWithoutProvenance(dataset)).toEqual([]);
    const carveOuts = routes().flatMap((r) => routeStatements(r)).filter((s) => s.except).length;
    expect(carveOuts).toBe(9);
    // 110 since s8: the closure on the French intra-corporate transfer card.
    // 154 since s9, which added forty-three sourced conditions across the five
    // routes that are quoted and not scored — none of them a carve-out — and one
    // more when the Spec review found article 76.2 read but not stated.
    expect(proseProvenance(dataset).with_provenance).toBe(154);
  });

  it("a fresher carve-out is a fresher dataset", () => {
    expect(datasetMeta(dataset).newest_retrieved_at).toBe("2026-09-10");
  });
});
