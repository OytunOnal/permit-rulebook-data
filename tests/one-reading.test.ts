import { describe, expect, it } from "vitest";
import { routeStatements } from "../src/engine.js";
import { validateDataset } from "../src/validate.js";
import type { Criterion, Dataset, ProvenancedAmount, ProvenancedText, Route } from "../src/types.js";
import { readJson } from "./read-json.js";
import { routeOf } from "./route-of.js";

const dataset = readJson<Dataset>("../data/dataset.json");

/** The paths the dataset check refuses on `ds` for a sentence read twice on one route. */
const pathsReadTwice = (ds: Dataset): string[] =>
  validateDataset(ds).errors.filter((e) => e.keyword === "oneReadingPerSentence").map((e) => e.path);

/** The source of a route's criterion quoting `quote`. Throws where none does. */
function criterionSourceQuoting(route: Route, quote: string): ProvenancedText {
  const criterion = route.criteria.find((c: Criterion) => "source" in c && c.source?.quote === quote);
  if (!criterion || !("source" in criterion) || !criterion.source)
    throw new Error(`precondition: ${route.id} has a criterion quoting "${quote}"`);
  return criterion.source;
}

/** The source of a route's first statement, and of the criterion quoting the
 * same sentence from the same page: a pair the card prints once. */
function statementAndCriterionOf(ds: Dataset, routeId: string): [ProvenancedText, ProvenancedText] {
  const route = routeOf(ds, routeId);
  const statement = routeStatements(route)[0]?.source;
  if (!statement) throw new Error(`precondition: ${routeId}'s first statement carries a source`);
  return [statement, criterionSourceQuoting(route, statement.quote)];
}

/** fr-talent-qualifie's salary threshold, whose sentence contains the shorter
 * "Avoir un contrat de travail de plus de 3 mois" its criterion and statement quote. */
function longerThresholdOf(ds: Dataset): ProvenancedAmount {
  const salary = routeOf(ds, "fr-talent-qualifie").criteria.find((c) => c.op === "gte");
  if (!salary || salary.op !== "gte") throw new Error("precondition: fr-talent-qualifie has a salary threshold");
  return salary.threshold;
}

// The check names the second value of a pair; on fr-talent-blue-card that is its first statement's source.
const BLUE_CARD_STATEMENT_PATH = "/countries/FR/routes/fr-talent-blue-card/statements/employment-contract-of-at-least-six-months/source";

/**
 * Each sentence of a page is quoted once per route (OytunOnal/permit-rulebook#421,
 * rulings 3 and 4 on #362): a route quoting one sentence twice under two legal
 * bases or two read dates prints it twice on its card.
 */
describe("the dataset check reads each sentence of a page once per route", () => {
  it("refuses a route quoting one sentence from one page with two legal bases", () => {
    const ds = structuredClone(dataset);
    const [statement, criterion] = statementAndCriterionOf(ds, "fr-talent-blue-card");
    statement.legal_basis = "Fiche F16922 — carte bleue européenne";
    criterion.legal_basis = "CESEDA, art. L421-11";
    expect(pathsReadTwice(ds)).toContain(BLUE_CARD_STATEMENT_PATH);
  });

  it("refuses a route quoting one sentence from one page with two read dates", () => {
    const ds = structuredClone(dataset);
    const [statement, criterion] = statementAndCriterionOf(ds, "fr-talent-blue-card");
    statement.legal_basis = criterion.legal_basis;
    statement.retrieved_at = "2026-01-01";
    expect(pathsReadTwice(ds)).toContain(BLUE_CARD_STATEMENT_PATH);
  });

  it("refuses a shorter quote contained in a longer one from the same page carrying two legal bases", () => {
    const ds = structuredClone(dataset);
    const [statement, criterion] = statementAndCriterionOf(ds, "fr-talent-qualifie");
    const threshold = longerThresholdOf(ds);
    for (const value of [statement, criterion]) Object.assign(value, { legal_basis: "A", retrieved_at: threshold.retrieved_at });
    threshold.legal_basis = "B";
    expect(pathsReadTwice(ds).filter((p) => p.includes("/fr-talent-qualifie/")).length).toBeGreaterThan(0);
  });

  it("refuses a shorter quote contained in a longer one from the same page carrying two read dates", () => {
    const ds = structuredClone(dataset);
    const [statement, criterion] = statementAndCriterionOf(ds, "fr-talent-qualifie");
    const threshold = longerThresholdOf(ds);
    for (const value of [statement, criterion]) Object.assign(value, { legal_basis: threshold.legal_basis, retrieved_at: "2026-01-01" });
    expect(pathsReadTwice(ds).filter((p) => p.includes("/fr-talent-qualifie/")).length).toBeGreaterThan(0);
  });

  it("accepts a shorter quote contained in a longer one when both carry one legal basis and read date", () => {
    const ds = structuredClone(dataset);
    const [statement, criterion] = statementAndCriterionOf(ds, "fr-talent-qualifie");
    const threshold = longerThresholdOf(ds);
    for (const value of [statement, criterion]) Object.assign(value, { legal_basis: threshold.legal_basis, retrieved_at: threshold.retrieved_at });
    expect(pathsReadTwice(ds).filter((p) => p.includes("/fr-talent-qualifie/"))).toEqual([]);
  });

  it("reads no superseded reading as a second quote: a re-read keeps its old read date in its history", () => {
    // de-blue-card-general's salary threshold carries its 2026-09-04 reading of
    // the same sentence in its history; the card prints only the live one.
    const salary = routeOf(dataset, "de-blue-card-general").criteria.find((c) => c.op === "gte" && (c.threshold.history?.length ?? 0) > 0);
    if (salary?.op !== "gte") throw new Error("precondition: de-blue-card-general has a re-read salary threshold");
    expect(salary.threshold.history![0]!.retrieved_at).not.toBe(salary.threshold.retrieved_at);
    expect(pathsReadTwice(dataset).filter((p) => p.includes("/de-blue-card-general/"))).toEqual([]);
  });
});
