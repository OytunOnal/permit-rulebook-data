import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import schema from "../schema/ruleset.schema.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { datasetMeta, fieldOptions, isScored, routeStatements, situationsAsked, statementSources } from "../src/engine.js";
import { quoteLanguage } from "../src/lang.js";
import { excludedLimbs, limbIdsOf, scopeDisagreesWithExclusions, twinDisagreesWithProse } from "../src/exclusions.js";
import { askedByCriterion, scopeLine } from "../src/scope.js";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "../src/watch/core.js";
import { QUOTED_NOT_SCORED } from "../src/types.js";
import type { Dataset, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const routes = (): Route[] => ds.countries.flatMap((c) => c.routes);
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;
const routeOf = (d: Dataset, id: string): Route => d.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));

/** The route s19 publishes: France's researcher card, quoted and not scored. */
const CHERCHEUR = "fr-talent-chercheur";
const FICHE = "https://www.service-public.gouv.fr/particuliers/vosdroits/F16922";

/**
 * s19 — a situation no scored route asks.
 *
 * A researcher with a French hosting agreement chose France, then the research
 * answer, and read "Nothing open on these answers" — a rejection, for a route
 * that is merely absent. The fact was derivable and nothing derived it:
 * France's scored routes gate on offer and ict, and the interview offered
 * research anyway. This is the data half: the derivation the interview reads,
 * and the route the reader is sent to.
 */
describe("s19 — which situations a destination's scored routes accept", () => {
  it("is derived from the routes' own situation gates, per destination answer", () => {
    const asked = situationsAsked(ds);
    // France's five scored routes gate on offer and ict; none takes research.
    expect([...asked.get("fr")!].sort()).toEqual(["ict", "offer"]);
    // Germany, Spain and the Netherlands each score a researcher route.
    for (const d of ["de", "es", "nl"]) expect(asked.get(d), d).toContain("research");
  });

  it("a route that reads no situation gate accepts every answer, the fallback included", () => {
    const asked = situationsAsked(ds);
    // The Opportunity Card and the orientation year are scored and never read
    // the situation — so "none of these yet" is an answer a German or Dutch
    // scored route takes, and one no French or Spanish route does. Derived,
    // not assumed: the assertion is about the dataset as it stands.
    expect(asked.get("de")).toContain("none");
    expect(asked.get("nl")).toContain("none");
    expect(asked.get("fr")).not.toContain("none");
    expect(asked.get("es")).not.toContain("none");
  });

  it("the four-country answer is the union, and it is every situation offered", () => {
    const asked = situationsAsked(ds);
    const union = new Set<string>();
    for (const [d, set] of asked) if (d !== "all") for (const s of set) union.add(s);
    expect([...asked.get("all")!].sort()).toEqual([...union].sort());
    // Every option question 2 offers has a scored route somewhere — no option
    // is marked on the four-country path.
    const offered = fieldOptions(ds, "situation").filter((o) => !o.is_unknown).map((o) => o.value);
    expect([...asked.get("all")!].sort()).toEqual([...offered].sort());
  });

  it("no list is typed: move a gate and the answer moves with it", () => {
    const moved = clone();
    const ict = routeOf(moved, "fr-ict");
    const gate = ict.criteria.find((c) => c.op === "eq" && c.field === "situation");
    expect(gate).toBeDefined();
    (gate as { value: string }).value = "research";
    const asked = situationsAsked(moved);
    expect(asked.get("fr")).toContain("research");
    // fr-talent-mission still takes ict.
    expect(asked.get("fr")).toContain("ict");
    const withoutMission = clone();
    for (const c of withoutMission.countries) c.routes = c.routes.filter((r) => r.id !== "fr-talent-mission");
    (routeOf(withoutMission, "fr-ict").criteria.find((c) => c.op === "eq" && c.field === "situation") as { value: string }).value = "research";
    expect(situationsAsked(withoutMission).get("fr")).not.toContain("ict");
  });

  it("a quoted route counts for nothing here — it asks nothing", () => {
    // The chercheur route says it would ask about research; the derivation
    // reads scored routes only, so France still lacks it.
    expect(routeOf(ds, CHERCHEUR).situations).toEqual(["research"]);
    expect(situationsAsked(ds).get("fr")).not.toContain("research");
  });
});

describe("s19 — Talent — chercheur enters the dataset, quoted and not scored", () => {
  const route = (): Route => routeOf(ds, CHERCHEUR);

  it("sits under France, asks nothing, and says what it would ask", () => {
    const fr = ds.countries.find((c) => c.code === "FR")!;
    expect(fr.routes.map((r) => r.id)).toContain(CHERCHEUR);
    expect(route().scope.value).toBe(QUOTED_NOT_SCORED);
    expect(route().criteria).toEqual([]);
    expect(isScored(route())).toBe(false);
    expect(route().kind).toBe(routeOf(ds, "de-researcher").kind);
    expect(route().info_url).toBe(FICHE);
    expect(route().slug).toBe("talent-researcher");
    expect(route().situations).toEqual(["research"]);
    // France: five scored, two quoted.
    expect(fr.routes.filter(isScored).length).toBe(5);
    expect(fr.routes.filter((r) => !isScored(r)).length).toBe(2);
  });

  it("states the fiche's gates in the fiche's own words, dated the day they were read", () => {
    const quoted = routeStatements(route()).flatMap(statementSources);
    expect(quoted.length).toBeGreaterThanOrEqual(5);
    const quotes = quoted.map((q) => q.quote);
    // The hosting agreement, the master's-level degree, the pay floor, the
    // duration, and who the card is for.
    expect(quotes.some((q) => q.includes("convention d'accueil"))).toBe(true);
    expect(quotes.some((q) => q.includes("au moins équivalent au master"))).toBe(true);
    expect(quotes.some((q) => q.includes("seuil de rémunération"))).toBe(true);
    expect(quotes.some((q) => q.includes("durée maximale de 4 ans"))).toBe(true);
    expect(quotes.some((q) => q.includes("« talent-chercheur »"))).toBe(true);
    for (const q of quoted) {
      expect(q.source_url).toBe(FICHE);
      expect(q.retrieved_at).toBe("2026-09-16");
      expect(quoteLanguage(q.source_url)).toBe("fr");
    }
  });

  it("every quote verifies against the fiche's snapshot — the watch reads the chercheur section", () => {
    const watchlist = readJson(new URL("../watch/watchlist.json", import.meta.url)) as Watchlist;
    const state = readJson(new URL("../watch/state.json", import.meta.url)) as WatchState;
    expect(checkCoverage(ds, watchlist).ok).toBe(true);
    const result = checkQuotes(ds, watchlist, state);
    expect(result.missing.filter((m) => m.where.startsWith(CHERCHEUR))).toEqual([]);
    expect(result.unverifiable.filter((u) => u.where.startsWith(CHERCHEUR))).toEqual([]);
    // And the rest of the fiche's quotes still verify through the widened slice.
    expect(result.missing.filter((m) => m.source_url === FICHE)).toEqual([]);
  });

  it("data/exclusions.md moves the row to quoted, not scored, with the date", () => {
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8").split("\r\n").join("\n");
    expect(text).toContain(`\`${CHERCHEUR}\``);
    expect(text).toMatch(/quoted and dated since s19/);
    expect(text).toContain("2026-09-16");
    const twin = excludedLimbs(text);
    expect([...twin.get(CHERCHEUR)!].sort()).toEqual([...route().scope.not_asked].sort());
  });

  it("the dataset says so in its version", () => {
    // 0.8.1 since s25: a points item may key its rows on two fields; 0.8.2
    // since s32: a statement may name the question that asks it.
    expect(datasetMeta(ds).schema_version).toBe("0.8.2");
    // 2026-09-17 since s29: the two free-movement sentences (the IND's EEA
    // sentence, Your Europe's Swiss one), read that day.
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-09-17");
  });
});

describe("s19 — `situations` is what a quoted route would ask, and nothing else", () => {
  it("names only answers the interview offers", () => {
    const offered = new Set(fieldOptions(ds, "situation").map((o) => o.value));
    for (const r of routes()) for (const s of r.situations ?? []) expect(offered.has(s), `${r.id}: ${s}`).toBe(true);
    // The schema's enum is the field's option list, and the two may not drift.
    const enumerated = (schema as { $defs: { route: { properties: { situations: { items: { enum: string[] } } } } } })
      .$defs.route.properties.situations.items.enum;
    expect([...enumerated].sort()).toEqual([...offered].sort());
  });

  it("a scored route may not carry it — its criteria already say what it asks", () => {
    const bad = clone();
    routeOf(bad, "nl-researcher").situations = ["research"];
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "situationsOnScoredRoute" && e.message.includes("nl-researcher"))).toBe(true);
  });

  it("an answer the situation question does not offer is refused", () => {
    const bad = clone();
    routeOf(bad, CHERCHEUR).situations = ["research", "sabbatical"];
    expect(validateDataset(bad).ok).toBe(false);
  });

  it("an empty list is refused — a route that would ask nothing leaves the field off", () => {
    const bad = clone();
    routeOf(bad, CHERCHEUR).situations = [];
    expect(validateDataset(bad).ok).toBe(false);
  });
});

/**
 * s19, from the site half's build: the scope line contradicted the card. On
 * es-researcher the hosting-agreement sentence is quoted BOTH by the situation
 * gate the interview asks AND by a precondition named in `scope.not_asked`, so
 * the card said "scored, one condition stated but not asked" two lines above
 * "Asked in the interview — you declared …". The rule: a statement whose
 * sentence a criterion of the same route also quotes is asked, not "not
 * asked". The line is derived from that rule; the authored `not_asked` list is
 * validated against it, because s6 made that list the curated twin of
 * data/exclusions.md and a derived twin would check nothing.
 */
describe("s19 — a sentence a criterion quotes is asked, not \"stated but not asked\"", () => {
  const exclusions = () => readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");

  it("knows which statements the interview asks", () => {
    // Read off the shared sentence until s32; read off the statement's own
    // `field` since — the two cases s19 decided are decided the same way, and
    // the sentence-keyed case this test carried (the same sentence on a
    // DIFFERENT route is not the same gate) retired with the key: a
    // statement's field is held to its own route by the validator.
    const es = routeOf(ds, "es-researcher");
    const hosting = routeStatements(es).find((s) => s.id === "hosting-agreement-or-contract-with-the-research-body")!;
    expect(askedByCriterion(es, hosting)).toBe(true);
    const nl = routeOf(ds, "nl-blue-card");
    expect(askedByCriterion(nl, routeStatements(nl).find((s) => s.id === "employment-contract-valid-for-six-months")!)).toBe(true);
    expect(askedByCriterion(nl, routeStatements(nl).find((s) => s.id === "mvv-needed")!)).toBe(false);
  });

  it("the scope line no longer counts them — es-researcher is scored against your answers, and nothing else", () => {
    expect(scopeLine(routeOf(ds, "es-researcher"))).toBe("quoted and dated · scored against your answers");
    expect(scopeLine(routeOf(ds, "fr-talent-innovante"))).toBe("quoted and dated · scored against your answers");
    // The counts are s19's; the words are s23's (v1.1 critique P4): figures,
    // a dash, "this interview did not ask", and a reading "in our own words,
    // not the authority's".
    const OURS = "in our own words, not the authority's";
    expect(scopeLine(routeOf(ds, "fr-talent-qualifie"))).toBe(`quoted and dated · scored — 1 condition this interview did not ask, ${OURS}`);
    // fr-talent-blue-card names two readings in `not_asked` and no statement:
    // the listed-professions reduction (s5f) and, since s25, the seven-year
    // question standing in for a five-year rule that names no window. The
    // line is derived from exactly those two.
    expect(routeOf(ds, "fr-talent-blue-card").scope.not_asked).toEqual(["listed-professions-not-modelled", "seven-year-answer-is-a-floor"]);
    expect(scopeLine(routeOf(ds, "fr-talent-blue-card"))).toBe(`quoted and dated · scored — 2 conditions this interview did not ask, ${OURS}`);
    expect(scopeLine(routeOf(ds, "fr-talent-mission"))).toBe("quoted and dated · scored — 1 condition this interview did not ask");
    expect(scopeLine(routeOf(ds, "nl-blue-card"))).toBe("quoted and dated · scored — 3 conditions this interview did not ask");
    expect(scopeLine(routeOf(ds, "nl-ict"))).toBe("quoted and dated · scored — 3 conditions this interview did not ask");
    // And the statements are still on the route — asked is not dropped.
    expect(limbIdsOf(routeOf(ds, "es-researcher")).has("hosting-agreement-or-contract-with-the-research-body")).toBe(true);
  });

  it("no route names such a statement as not asked, and the build refuses one that does", () => {
    for (const r of routes())
      for (const s of routeStatements(r))
        if (askedByCriterion(r, s)) expect(r.scope.not_asked, `${r.id}: ${s.id}`).not.toContain(s.id);
    const bad = clone();
    routeOf(bad, "es-researcher").scope.not_asked = ["hosting-agreement-or-contract-with-the-research-body"];
    routeOf(bad, "es-researcher").scope.value = "some-conditions-stated-not-asked";
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    // `notAskedButQuotedByCriterion` until s32, when the field became the key.
    expect(result.errors.some((e) => e.keyword === "notAskedButAsked" && e.message.includes("es-researcher"))).toBe(true);
  });

  it("a route left with no unasked limb says it asks everything, and exclusions.md agrees", () => {
    for (const id of ["es-researcher", "fr-talent-innovante"]) {
      expect(routeOf(ds, id).scope.not_asked, id).toEqual([]);
      expect(routeOf(ds, id).scope.value, id).toBe("every-deciding-rule-asked");
    }
    expect(scopeDisagreesWithExclusions(ds, exclusions())).toEqual([]);
    expect(twinDisagreesWithProse(exclusions())).toEqual([]);
  });
});
