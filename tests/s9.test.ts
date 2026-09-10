import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { evaluate, isScored, routeStatements, statementSources } from "../src/engine.js";
import { scopeLine } from "../src/scope.js";
import { deriveQuestions } from "../src/questions.js";
import { excludedLimbs } from "../src/exclusions.js";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "../src/watch/core.js";
import { QUOTED_NOT_SCORED } from "../src/types.js";
import type { Dataset, Profile, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const routes = (): Route[] => ds.countries.flatMap((c) => c.routes);
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

/** The five s9 publishes: the routes this product states and will not score. */
const QUOTED_ONLY = [
  "fr-salarie", "es-cuenta-ajena", "es-teletrabajo", "de-selbstaendige-taetigkeit", "nl-gvva",
] as const;

const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;

/**
 * s9 — five routes the product will not score, quoted and dated anyway.
 *
 * Each of the five was researched and left out because something in it cannot
 * be computed from what a reader can declare: a labour-market test, a
 * discretionary assessment, an arithmetic floor with no official figure to
 * quote. The dataset has had the vocabulary for this since s6 and never used
 * it; the state is a promise about what the product does, and a promise a
 * schema does not hold is a wish.
 */
describe("s9 — a route may be quoted and dated without being scored", () => {
  it("the five are in the dataset, each declaring that nothing is asked", () => {
    for (const id of QUOTED_ONLY) {
      const route = routeOf(id);
      expect(route, id).toBeDefined();
      expect(route.scope.value, id).toBe(QUOTED_NOT_SCORED);
      expect(scopeLine(route), id).toBe("quoted and dated · not scored");
    }
    // 23 scored, five quoted and not scored.
    expect(routes().filter(isScored).length).toBe(23);
    expect(routes().filter((r) => !isScored(r)).length).toBe(5);
  });

  it("each states its rules as the authority does, with a quote and a day", () => {
    for (const id of QUOTED_ONLY) {
      const route = routeOf(id);
      const quoted = routeStatements(route).flatMap(statementSources);
      expect(quoted.length, id).toBeGreaterThan(0);
      for (const source of quoted) {
        expect(source.quote.trim().length, `${id}: ${source.source_url}`).toBeGreaterThan(0);
        expect(source.source_url, id).toMatch(/^https:\/\//);
        expect(source.retrieved_at, `${id}: ${source.quote.slice(0, 40)}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      // It says why in our own words, before any rule. The sentence is
      // authored for this route — the uniqueness check below is what proves
      // that — and the route page prints it whole, which is what proves it is
      // written for a reader. A length threshold proved neither: it passes on
      // a padded sentence (Standards review, 2026-09-10).
      expect(route.scope.reason.trim().length, id).toBeGreaterThan(0);
    }
    const reasons = QUOTED_ONLY.map((id) => routeOf(id).scope.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  /**
   * The rule the spec asked for: the state is a promise about what the product
   * does, so the schema holds it in both directions. A criterion is the one
   * thing in this dataset that decides a case — a route that carries one is
   * scored, whatever its scope statement claims.
   */
  it("a route that asks nothing may not carry a deciding rule", () => {
    const bad = clone();
    const route = bad.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-gvva")!;
    route.criteria = [{ field: "citizenship", op: "eq", value: "third_country" }];
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toContain("nl-gvva");
    expect(result.errors.some((e) => e.keyword === "quotedNothingAsked")).toBe(true);
  });

  it("a route with deciding rules may not claim that nothing is asked", () => {
    const bad = clone();
    const route = bad.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-researcher")!;
    route.scope.value = QUOTED_NOT_SCORED;
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "quotedNothingAsked")).toBe(true);
  });

  it("a scored route may not ship with no rules at all", () => {
    const bad = clone();
    const route = bad.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-researcher")!;
    route.criteria = [];
    expect(validateDataset(bad).ok).toBe(false);
  });

  /**
   * The guarantee behind the promise. An unscored route carries no criteria,
   * so every criterion of it passes vacuously and `routeStatus` would call it
   * met for everybody — "naturally out" is exactly the kind of accident the
   * validation above exists to refuse, and the engine says it itself.
   */
  it("evaluate never returns one of them, whatever the profile", () => {
    const unscored = new Set<string>(QUOTED_ONLY);
    const answers: Profile[] = [
      {},
      { citizenship: "third_country", destination: "all" },
      { citizenship: "TR", destination: "nl", situation: "offer" },
      { citizenship: "third_country", destination: "de", situation: "none", qualification: "none" },
      { citizenship: "IN", destination: "es", situation: "offer", qualification: "degree" },
      { citizenship: "third_country", destination: "fr", situation: "ict" },
    ];
    for (const profile of answers) {
      const got = evaluate(ds, profile).map((r) => r.route.id);
      expect(got.filter((id) => unscored.has(id)), JSON.stringify(profile)).toEqual([]);
      expect(got.length, JSON.stringify(profile)).toBe(23);
    }
  });

  it("an unscored route adds no question to the interview", () => {
    const asked = deriveQuestions(ds).map((q) => q.field);
    const withoutThem = clone();
    for (const country of withoutThem.countries)
      country.routes = country.routes.filter((r) => isScored(r));
    expect(asked).toEqual(deriveQuestions(withoutThem).map((q) => q.field));
  });

  it("data/exclusions.md still records all five — a page is not a score", () => {
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8")
      .split("\r\n").join("\n");
    const twin = excludedLimbs(text);
    for (const id of QUOTED_ONLY) {
      expect(twin.has(id), id).toBe(true);
      // Nothing of these routes is asked, so every limb the page names is a
      // limb the file records.
      expect([...twin.get(id)!].sort(), id).toEqual([...routeOf(id).scope.not_asked].sort());
    }
  });

  it("every new source is watched, and every new quote is still on its page", () => {
    const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));
    const watchlist = readJson(new URL("../watch/watchlist.json", import.meta.url)) as Watchlist;
    const state = readJson(new URL("../watch/state.json", import.meta.url)) as WatchState;
    expect(checkCoverage(ds, watchlist).ok).toBe(true);
    const quotes = checkQuotes(ds, watchlist, state);
    expect(quotes.missing).toEqual([]);
    // The five stand on sources a machine here can re-read: none of them is a
    // human-tier entry.
    const unscoredSources = new Set(
      QUOTED_ONLY.flatMap((id) => routeStatements(routeOf(id)).flatMap(statementSources))
        .map((s) => s.source_url),
    );
    expect(quotes.unverifiable.filter((u) => unscoredSources.has(u.source_url))).toEqual([]);
  });
});
