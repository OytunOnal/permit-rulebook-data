import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import schema from "../schema/ruleset.schema.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { datasetMeta, forEachCriterion, provenancedValuesOf, referencedFields, routeStatements } from "../src/engine.js";
import { askedByCriterion, scopeLine, statedNotAsked } from "../src/scope.js";
import { scopeDisagreesWithExclusions, twinDisagreesWithProse } from "../src/exclusions.js";
import type { Dataset, Route, RouteStatement } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;
const routeOf = (d: Dataset, id: string): Route => d.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
const statementOf = (d: Dataset, route: string, id: string): RouteStatement =>
  routeStatements(routeOf(d, route)).find((s) => s.id === id)!;
const exclusions = () => readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");

/**
 * s32 — a statement names the question that asks it.
 *
 * s19 derived "asked" from a shared sentence: a precondition whose quote a
 * criterion of the same route also quotes, verbatim, was held to be asked.
 * Three more statements shared a sentence by containment and were not caught,
 * and read on 2026-09-18 the sentence would have decided two of the three
 * wrongly — a tenure is not what the situation question asks, even where the
 * question's quote sits inside the tenure's. So the key is a curator's
 * decision, typed: `field`, the question whose answer covers the statement.
 */

/** The eleven the scenario decides: the eight verbatim matches, the hosting
 * agreement containment caught wrongly by the old rule, and the two tenures. */
const DECIDED: { route: string; statement: string; field: string | undefined }[] = [
  { route: "fr-talent-qualifie", statement: "employment-contract-of-more-than-three-months", field: "situation" },
  { route: "fr-talent-blue-card", statement: "employment-contract-of-at-least-six-months", field: "situation" },
  { route: "fr-talent-innovante", statement: "work-tied-to-the-research-and-development-project", field: "situation" },
  { route: "fr-talent-innovante", statement: "a-young-innovative-company-or-one-the-ministry-recognises", field: "fr_innovative_employer" },
  { route: "fr-talent-mission", statement: "a-move-inside-one-company-or-group", field: "situation" },
  { route: "es-researcher", statement: "hosting-agreement-or-contract-with-the-research-body", field: "situation" },
  { route: "nl-blue-card", statement: "employment-contract-valid-for-six-months", field: "situation" },
  { route: "nl-ict", statement: "three-months-with-the-company-outside-the-union", field: "situation" },
  { route: "de-researcher", statement: "hosting-agreement-with-a-research-facility", field: "situation" },
  { route: "de-ict-card", statement: "six-months-with-the-company-before-the-transfer", field: undefined },
  { route: "fr-ict", statement: "six-months-with-the-group-already", field: undefined },
];

describe("s32 — `field` on a statement is the question whose answer covers it", () => {
  it("the schema admits it as an optional field id, in a field id's own shape", () => {
    const statement = (schema as { $defs: { routeStatement: { properties: Record<string, { type?: string; pattern?: string }>; required: string[] } } })
      .$defs.routeStatement;
    expect(statement.properties.field).toEqual(expect.objectContaining({ type: "string" }));
    expect(statement.required).not.toContain("field");
    // The same shape a field id has, so a typo fails before the validator
    // runs; which ids exist is the validator's business, below.
    const fieldId = (schema as { $defs: { fieldDef: { properties: { id: { pattern: string } } } } }).$defs.fieldDef.properties.id.pattern;
    expect(statement.properties.field!.pattern).toBe(fieldId);
  });

  it("the build refuses a field this dataset does not ask", () => {
    const bad = clone();
    statementOf(bad, "es-researcher", "hosting-agreement-or-contract-with-the-research-body").field = "hosting_agreement";
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.keyword === "knownStatementField");
    expect(error?.message).toContain("es-researcher");
    expect(error?.message).toContain("hosting-agreement-or-contract-with-the-research-body");
    expect(error?.message).toContain("hosting_agreement");
  });

  it("and a field no criterion of the same route reads — the route never asks it", () => {
    const bad = clone();
    // A real question, asked by other routes, and by no rule of this one.
    const de = routeOf(bad, "de-researcher");
    expect(de.criteria.flatMap(referencedFields)).not.toContain("fr_innovative_employer");
    statementOf(bad, "de-researcher", "hosting-agreement-with-a-research-facility").field = "fr_innovative_employer";
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.keyword === "statementFieldNotRead");
    expect(error?.message).toContain("de-researcher");
    expect(error?.message).toContain("hosting-agreement-with-a-research-facility");
    expect(error?.message).toContain("fr_innovative_employer");
  });

});

describe("s32 — asked is the field, not the sentence", () => {
  it("the eleven read as the scenario decided them", () => {
    for (const d of DECIDED) {
      const s = statementOf(ds, d.route, d.statement);
      expect(s, `${d.route}: ${d.statement}`).toBeDefined();
      expect(s.field, `${d.route}: ${d.statement}`).toBe(d.field);
      expect(askedByCriterion(s), `${d.route}: ${d.statement}`).toBe(d.field !== undefined);
    }
  });

  it("a shared sentence decides nothing on its own: the same statement with the field struck is not asked", () => {
    const moved = clone();
    const es = routeOf(moved, "es-researcher");
    const hosting = statementOf(moved, "es-researcher", "hosting-agreement-or-contract-with-the-research-body");
    // The criterion still quotes the very sentence — the old key — and the
    // answer no longer turns on it.
    let quoted = false;
    forEachCriterion(es.criteria, (c) => { for (const p of provenancedValuesOf(c)) if (p.value.quote === hosting.source!.quote) quoted = true; });
    expect(quoted).toBe(true);
    delete hosting.field;
    expect(askedByCriterion(hosting)).toBe(false);
  });

  it("the two tenures stand in `not checked here`, and the hosting agreement on de-researcher leaves it", () => {
    const de = routeOf(ds, "de-ict-card");
    expect(statedNotAsked(de)).toContain(statementOf(ds, "de-ict-card", "six-months-with-the-company-before-the-transfer").text);
    const fr = routeOf(ds, "fr-ict");
    expect(statedNotAsked(fr)).toContain(statementOf(ds, "fr-ict", "six-months-with-the-group-already").text);
    const researcher = routeOf(ds, "de-researcher");
    expect(statedNotAsked(researcher)).not.toContain(statementOf(ds, "de-researcher", "hosting-agreement-with-a-research-facility").text);
    // Which leaves de-researcher, like es-researcher since s19, asking
    // everything it turns on: the scope says so and names no limb.
    expect(researcher.scope.value).toBe("every-deciding-rule-asked");
    expect(researcher.scope.not_asked).toEqual([]);
    expect(scopeLine(researcher)).toBe(scopeLine(routeOf(ds, "es-researcher")));
    // The other two routes' lines are what they were.
    expect(scopeLine(de)).toBe("quoted and dated · scored — 2 conditions this interview did not ask");
    expect(scopeLine(fr)).toBe("quoted and dated · scored — 3 conditions this interview did not ask and 1 condition in our own words, not the authority's");
    // And the twin agrees.
    expect(scopeDisagreesWithExclusions(ds, exclusions())).toEqual([]);
    expect(twinDisagreesWithProse(exclusions())).toEqual([]);
  });
});

describe("s32 — the verbatim cross-check runs the other way: a shared sentence must be decided", () => {
  it("nowhere is it blank today — the validator, which holds the rule, passes the dataset", () => {
    expect(validateDataset(clone()).ok).toBe(true);
  });

  it("the build refuses the blank, naming the route and the statement", () => {
    const bad = clone();
    delete statementOf(bad, "nl-blue-card", "employment-contract-valid-for-six-months").field;
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.keyword === "quotedByCriterionUndecided");
    expect(error?.message).toContain("nl-blue-card");
    expect(error?.message).toContain("employment-contract-valid-for-six-months");
  });

  it("and accepts the same sentence decided the other way — named as not asked", () => {
    const decided = clone();
    const nl = routeOf(decided, "nl-blue-card");
    delete statementOf(decided, "nl-blue-card", "employment-contract-valid-for-six-months").field;
    nl.scope.not_asked = [...nl.scope.not_asked, "employment-contract-valid-for-six-months"];
    const result = validateDataset(decided);
    expect(result.errors.filter((e) => e.keyword === "quotedByCriterionUndecided")).toEqual([]);
    // The twin in exclusions.md is a test's business, not the validator's:
    // this is the only complaint left, and it is not one.
    expect(result.ok).toBe(true);
  });

  it("a statement that carries a field may not also be named as not asked", () => {
    const bad = clone();
    const de = routeOf(bad, "de-researcher");
    de.scope.not_asked = ["hosting-agreement-with-a-research-facility"];
    de.scope.value = "some-conditions-stated-not-asked";
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.keyword === "notAskedButAsked");
    expect(error?.message).toContain("de-researcher");
    expect(error?.message).toContain("hosting-agreement-with-a-research-facility");
    expect(error?.message).toContain("situation");
  });
});

describe("s32 — the dataset says so in its version", () => {
  it("schema 0.8.2 for the field; the day is the day the eleven were decided; nothing was read at a source", () => {
    expect(datasetMeta(ds).schema_version).toBe("0.8.2");
    expect(datasetMeta(ds).dataset_version).toBe("2026.09.18");
    // Every quote keeps its date: the decision is which question covers a
    // sentence already held, not a new read of it.
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-09-17");
  });
});
