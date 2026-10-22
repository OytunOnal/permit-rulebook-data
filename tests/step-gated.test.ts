import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, isStepGated } from "../src/index.js";
import type { Dataset, Profile, RouteResult } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** The result the engine gives a route for a profile. Throws where it gives
 * none, so a case never reads a property of nothing. */
function resultOf(ds: Dataset, profile: Profile, routeId: string): RouteResult {
  const result = evaluate(ds, profile).find((r) => r.route.id === routeId);
  if (!result) throw new Error(`precondition: the dataset evaluates a route ${routeId}`);
  return result;
}

// Strong credentials and no job offer: the skilled-worker route for academics
// asks for an offer and nothing else this reader lacks.
const explorer: Profile = {
  destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
  recognition_de: "recognized", occupation_shortage: "yes", experience_5y: "2plus", experience_7y: "3to5",
  german: "b1", funds_eur_month: "band_1", salary_eur_year: "band_5",
};

describe("a step-gated row: a not-yet route whose only genuine failure is a path answer", () => {
  it("a route failing only on the situation answer is step-gated", () => {
    const result = resultOf(dataset, explorer, "de-skilled-academic");
    expect(isStepGated(dataset, result, explorer)).toBe(true);
  });

  it("a route failing on the situation answer and on an improvable answer is not", () => {
    // The general Blue Card asks this reader for an offer and for more salary.
    const result = resultOf(dataset, explorer, "de-blue-card-general");
    const failing = result.criteria.filter((cr) => cr.outcome === "fail").map((cr) => cr.criterion);
    expect(failing.map((c) => ("field" in c ? c.field : c.op)).sort()).toEqual(["salary_eur_year", "situation"]);
    expect(isStepGated(dataset, result, explorer)).toBe(false);
  });
});
