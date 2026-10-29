import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, isStepGated, mootWith } from "../src/index.js";
import type { Dataset, Profile, RouteResult } from "../src/types.js";
import { routeOf } from "./route-of.js";

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

  it("the same reader with an \"I don't know\" that still binds on that route is not", () => {
    // Every path failure is a hard fail today, and a hard-failed route has no
    // live unknown, so the engine never hands over this row: it is the engine's
    // result with the hard fail lifted, the shape the day a path failure leaves
    // a route alive.
    const unsure: Profile = { ...explorer, recognition_de: "unknown" };
    const evaluated = resultOf(dataset, unsure, "de-skilled-academic");
    expect(evaluated.hard_fail).toBe(true);
    expect(evaluated.unknown_fields).toContain("recognition_de");
    expect(isStepGated(dataset, { ...evaluated, hard_fail: false }, unsure)).toBe(false);
  });

  it("the Opportunity Card for an offer-holder, whose situation criterion is moot, is not", () => {
    // No shipped route asks for the absence of a step (verdict.test.ts), so the
    // case writes its own dataset: the card with a criterion wanting no job
    // offer yet, failed by a reader who has one.
    const written = structuredClone(dataset);
    routeOf(written, "de-chancenkarte").criteria.push({ field: "situation", op: "eq", value: "none" });
    const readerWithJobOffer: Profile = {
      destination: "de", citizenship: "TR", situation: "offer", qualification: "degree",
      german: "a1", funds_eur_month: "band_1", recognition_de: "recognized",
    };
    const result = resultOf(written, readerWithJobOffer, "de-chancenkarte");
    const failing = result.criteria.filter((cr) => cr.outcome === "fail");
    expect(failing.length).toBe(1);
    expect(mootWith(written, failing[0]!, readerWithJobOffer)).not.toBeNull();
    expect(isStepGated(written, result, readerWithJobOffer)).toBe(false);
  });

  it("a route failing on the situation answer and on an improvable answer is not", () => {
    // The general Blue Card asks this reader for an offer and for more salary.
    const result = resultOf(dataset, explorer, "de-blue-card-general");
    const failing = result.criteria.filter((cr) => cr.outcome === "fail").map((cr) => cr.criterion);
    expect(failing.map((c) => ("field" in c ? c.field : c.op)).sort()).toEqual(["salary_eur_year", "situation"]);
    expect(isStepGated(dataset, result, explorer)).toBe(false);
  });
});
