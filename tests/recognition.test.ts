import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, fieldOptions, isClosed, isRouteAlive } from "../src/index.js";
import type { CriterionResult, Dataset, Profile, RouteResult } from "../src/index.js";
import { lcg, randomProfile } from "./random-profile.js";

/**
 * A degree never assessed and a degree assessed and refused are two answers a
 * reader can tell apart, and no criterion and no points row reads them apart
 * (#92, ruling 9).
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const FIELD = "recognition_de";
const NOT_ASSESSED = "not_assessed";
const NOT_RECOGNISED = "not_recognised";
const UNRECOGNISED_ANSWERS = [NOT_ASSESSED, NOT_RECOGNISED];

const offeredValues = (): string[] => fieldOptions(dataset, FIELD).map((o) => o.value);

/** The precondition every case below stands on: the question offers both answers. */
function expectBothOffered(): void {
  expect(offeredValues()).toEqual(expect.arrayContaining(UNRECOGNISED_ANSWERS));
}

/** Every result, at any depth, of a non-points criterion that reads the recognition answer. */
function recognitionResultsOf(r: RouteResult): CriterionResult[] {
  const found: CriterionResult[] = [];
  const walk = (results: CriterionResult[]): void => {
    for (const cr of results) {
      const c = cr.criterion;
      if (c.op !== "points" && "field" in c && c.field === FIELD) found.push(cr);
      for (const path of cr.path_results ?? []) walk(path);
    }
  };
  walk(r.criteria);
  return found;
}

/** What a reader is told about a route: everything evaluate decides, without the route itself. */
const verdictOf = ({ route: _, ...verdict }: RouteResult) => verdict;

describe("the recognition question's two unrecognised answers", () => {
  it("are offered as two answers, and the one answer that covered both is gone", () => {
    const values = offeredValues();
    expect(values).toEqual(expect.arrayContaining(UNRECOGNISED_ANSWERS));
    expect(values).not.toContain("not_yet");
  });

  it("each fails every criterion that needs full recognition, and closes or retires no route", () => {
    expectBothOffered();
    const recognised = evaluate(dataset, { [FIELD]: "recognized" }).flatMap(recognitionResultsOf);
    expect(recognised.length).toBeGreaterThan(0); // precondition: some criterion reads the answer
    expect(recognised.every((cr) => cr.outcome === "pass")).toBe(true); // precondition: full recognition meets them
    for (const answer of UNRECOGNISED_ANSWERS) {
      const profile: Profile = { [FIELD]: answer };
      for (const r of evaluate(dataset, profile)) {
        for (const cr of recognitionResultsOf(r)) expect(cr.outcome, `${r.route.id} on ${answer}`).toBe("fail");
        expect(isClosed(r), `${r.route.id} on ${answer}`).toBe(false);
        expect(isRouteAlive(dataset, r.route, profile), `${r.route.id} on ${answer}`).toBe(true);
      }
    }
  });

  it("each scores nothing on a points row", () => {
    expectBothOffered();
    const scoredOn = (answer: string): string[] =>
      evaluate(dataset, { [FIELD]: answer })
        .filter((r) => r.points?.items.some((i) => i.field === FIELD))
        .map((r) => r.route.id);
    expect(scoredOn("partial").length).toBeGreaterThan(0); // precondition: a points row reads the answer
    for (const answer of UNRECOGNISED_ANSWERS) expect(scoredOn(answer), answer).toEqual([]);
  });

  it("give the same verdict as each other on every route, over the seeded profiles", () => {
    expectBothOffered();
    const rand = lcg(157);
    for (let i = 0; i < 400; i++) {
      const profile = randomProfile(dataset, rand, i % 2 === 0 ? 1 : 0.6);
      const assessed = evaluate(dataset, { ...profile, [FIELD]: NOT_ASSESSED }).map(verdictOf);
      const refused = evaluate(dataset, { ...profile, [FIELD]: NOT_RECOGNISED }).map(verdictOf);
      expect(refused, JSON.stringify(profile)).toEqual(assessed);
    }
  });
});
