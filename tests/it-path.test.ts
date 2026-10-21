import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate } from "../src/index.js";
import type { Criterion, CriterionResult, Dataset, Profile, RouteResult } from "../src/index.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const SHORTAGE_CARD = "de-blue-card-shortage";

/** The band a euro figure falls in, so a case names the figure and not a band id. */
function bandFor(field: string, amount: number): string {
  return deriveBands(dataset, field).find(
    (b) => (b.min === undefined || amount >= b.min) && (b.max === undefined || amount < b.max),
  )!.id;
}

const shortageCardFor = (profile: Profile): RouteResult =>
  evaluate(dataset, profile).find((r) => r.route.id === SHORTAGE_CARD)!;

const fieldsReadBy = (criteria: Criterion[]): string[] =>
  criteria.flatMap((c) => ("field" in c ? [c.field] : []));

/** The card's disjunction between a degree and IT experience: the `any` one of whose paths reads the qualification. */
const qualifyingDisjunctionOf = (r: RouteResult): CriterionResult | undefined =>
  r.criteria.find((cr) => cr.criterion.op === "any" &&
    cr.criterion.paths.some((p) => fieldsReadBy(p.criteria).includes("qualification")));

/** An IT worker with no degree, offered the shortage card's own lower threshold in Germany. */
const itWorkerWithoutDegree: Profile = {
  destination: "de", citizenship: "IN", situation: "offer", qualification: "none",
  occupation_it: "yes", experience_7y: "3to5", salary_eur_year: bandFor("salary_eur_year", 45934.2),
};

describe("the shortage-occupation Blue Card's IT path", () => {
  it("meets an IT worker without a degree, with 3 to under 5 years in the last seven, at the lower threshold", () => {
    const r = shortageCardFor(itWorkerWithoutDegree);
    expect(r.status).toBe("met");
    const path = qualifyingDisjunctionOf(r)!.path!;
    expect(fieldsReadBy(path.criteria.map((cr) => cr.criterion))).toEqual(["occupation_it", "experience_7y"]);
  });

  it("under 3 years in the last seven does not meet it: the experience rung is what stands between them", () => {
    const short = shortageCardFor({ ...itWorkerWithoutDegree, experience_7y: "lt3" });
    expect(short.status).not.toBe(shortageCardFor(itWorkerWithoutDegree).status);
    expect(short.status).not.toBe("met");
    // Everything outside the disjunction still holds; only the degree-or-IT rule fails.
    expect(short.criteria.filter((cr) => cr.outcome !== "pass")).toEqual([qualifyingDisjunctionOf(short)]);
    expect(qualifyingDisjunctionOf(short)!.outcome).toBe("fail");
  });

  it("the shortage-list answer, whichever it is, does not reach the IT path", () => {
    for (const answer of ["yes", "no", "unknown"]) {
      const r = shortageCardFor({ ...itWorkerWithoutDegree, occupation_shortage: answer });
      expect(r.status, answer).toBe("met");
      const path = qualifyingDisjunctionOf(r)!.path!;
      expect(fieldsReadBy(path.criteria.map((cr) => cr.criterion)), answer).not.toContain("occupation_shortage");
    }
  });

  it("a degree holder outside the shortage list who works in IT with the experience meets it through the IT path", () => {
    const r = shortageCardFor({
      ...itWorkerWithoutDegree, qualification: "degree", recognition_de: "recognized", occupation_shortage: "no",
    });
    expect(r.status).toBe("met");
    expect(fieldsReadBy(qualifyingDisjunctionOf(r)!.path!.criteria.map((cr) => cr.criterion)))
      .toEqual(["occupation_it", "experience_7y"]);
  });
});

describe("what the IT path states and never asks", () => {
  it("the academic-level IT job and the Federal Employment Agency's approval are preconditions from the IT path's own source, listed as not asked", () => {
    const route = shortageCardFor(itWorkerWithoutDegree).route;
    const itPath = route.criteria.flatMap((c) => (c.op === "any" ? c.paths : []))
      .find((p) => fieldsReadBy(p.criteria).includes("occupation_it"))!;
    const itSources = itPath.criteria.map((c) => ({ url: c.source!.source_url, basis: c.source!.legal_basis }));
    for (const id of ["academic-level-it-job", "federal-employment-agency-approval"]) {
      const statement = route.statements?.find((s) => s.id === id);
      expect(statement, id).toBeDefined();
      expect(statement!.kind).toBe("precondition");
      expect(statement!.field, id).toBeUndefined();
      expect(itSources).toContainEqual({ url: statement!.source!.source_url, basis: statement!.source!.legal_basis });
      expect(route.scope.not_asked).toContain(id);
    }
  });
});

describe("the shortage-occupation Blue Card's degree path", () => {
  const recognisedShortageGraduate: Profile = {
    destination: "de", citizenship: "IN", situation: "offer", qualification: "degree",
    recognition_de: "recognized", occupation_shortage: "yes", occupation_it: "no", experience_7y: "lt3",
  };

  it("a recognised degree in a shortage occupation gets the result it got before", () => {
    const above = shortageCardFor({ ...recognisedShortageGraduate, salary_eur_year: bandFor("salary_eur_year", 46000) });
    expect(above.status).toBe("met");
    // The band just below the threshold starts at €45,630 (the experienced-worker
    // threshold), so the worst-case gap is €45,934.20 − €45,630.
    const below = shortageCardFor({ ...recognisedShortageGraduate, salary_eur_year: bandFor("salary_eur_year", 45800) });
    expect(below.status).toBe("near");
    expect(below.gap_max).toBeCloseTo(304.2, 2);
  });

  it("a reader who meets both paths is met", () => {
    const r = shortageCardFor({
      ...recognisedShortageGraduate, occupation_it: "yes", experience_7y: "5plus",
      salary_eur_year: bandFor("salary_eur_year", 46000),
    });
    expect(r.status).toBe("met");
  });
});
