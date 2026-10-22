import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveBands, evaluate, formatEURPer, gapCriterionOf, reasonFor, unlockTitleOf, unlocks,
  type Dataset, type Profile,
} from "../src/index.js";
import { routeOf } from "./route-of.js";

/**
 * A gap is said one way (#174; rulings 3 and 11 on #55).
 *
 * The card's one-line explanation and a money step's title print a gap the
 * way the site's headline, gap note and rail do: exact, cents only where it
 * has them, with its period, so "up to" never understates it. A band open at
 * the bottom has no lower edge to measure a gap from, so the sentence names
 * the line the route asks, never that line as the reader's shortfall.
 *
 * Only the sentence's words tell "up to" from the line, so those cases read
 * them; every amount they look for is computed from the dataset's thresholds.
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** The v1.2.1 gate's hostile walk: a Nigerian passport, Germany, a job offer,
 * no completed qualification, IT, two years in the last five. One route stands
 * within reach of it on salary. */
const HOSTILE: Profile = {
  destination: "de", citizenship: "NG", situation: "offer", situation_country: "de", qualification: "none",
  occupation_it: "yes", experience_5y: "2plus",
};

const SALARY = "salary_eur_year";
const PERIOD = dataset.fields.find((f) => f.id === SALARY)!.period;
const bands = deriveBands(dataset, SALARY);

/** The yearly salary a route asks, read from the dataset. */
function salaryLineOf(routeId: string): number {
  const asked = routeOf(dataset, routeId).criteria.find((c) => c.op === "gte" && c.field === SALARY);
  if (asked?.op !== "gte") throw new Error(`precondition: ${routeId} asks a yearly salary`);
  return asked.threshold.amount;
}

/** The bounded salary band that ends at a line, with its floor. */
function bandUnder(line: number) {
  const under = bands.find((b) => b.max === line);
  if (under?.min === undefined) throw new Error(`precondition: a bounded band ends at ${line}`);
  return { ...under, min: under.min };
}

/** Whether an amount has cents: what "exact" can be told from rounded by. */
const hasCents = (amount: number) => Math.round(amount * 100) % 100 !== 0;

/** The one route within reach on a money gap: its card's sentence and the threshold it was measured against. */
function sentenceAndThresholdOf(answers: Profile) {
  const near = evaluate(dataset, answers).filter((r) => r.status === "near" && r.gap_max !== undefined);
  expect(near.length, "precondition: one route within reach on a money gap").toBe(1);
  const r = near[0]!;
  return { sentence: reasonFor(dataset, r, answers).line, threshold: gapCriterionOf(dataset, r, answers)!.threshold.amount };
}

describe("the card's sentence says a gap exactly, or the line", () => {
  it("a bounded band with a gap in cents prints its cents and its period", () => {
    const line = salaryLineOf("de-experienced-worker");
    const under = bandUnder(line);
    expect(hasCents(line - under.min), "precondition: the gap has cents").toBe(true);
    const { sentence, threshold } = sentenceAndThresholdOf({ ...HOSTILE, [SALARY]: under.id });
    expect(threshold, "precondition: the gap is measured to the route's line").toBe(line);
    expect(sentence).toContain(`Up to ${formatEURPer(line - under.min, PERIOD)} short`);
  });

  it("the lowest band names the line the route asks, and never says up to", () => {
    const lowest = bands.find((b) => b.min === undefined)!;
    const { sentence, threshold } = sentenceAndThresholdOf({ ...HOSTILE, [SALARY]: lowest.id });
    expect(sentence).toContain(`Needs ${formatEURPer(threshold, PERIOD)} or more`);
    expect(sentence).not.toMatch(/up to/i);
    expect(sentence).not.toMatch(/short/i);
  });
});

describe("a money step's amount is exact", () => {
  it("the distance from the declared band's floor to the step's, with its cents", () => {
    const line = salaryLineOf("de-experienced-worker");
    const under = bandUnder(line);
    expect(hasCents(line - under.min), "precondition: the distance has cents").toBe(true);
    const declared: Profile = {
      destination: "de", citizenship: "IN", situation: "offer", qualification: "degree",
      recognition_de: "recognized", occupation_shortage: "no", experience_5y: "2plus", experience_7y: "3to5",
      german: "b1", english: "c1", age_band: "a30to35", de_stay6m: "no", partner_ck: "no",
      funds_eur_month: "band_1", [SALARY]: under.id,
    };
    const toTheLine = unlocks(dataset, declared)
      .find((u) => u.field === SALARY && bands.find((b) => b.id === u.option.value)?.min === line);
    expect(toTheLine, "precondition: a step up to the line").toBeDefined();
    expect(unlockTitleOf(dataset, toTheLine!, declared)).toContain(`${formatEURPer(line - under.min, PERIOD)} more`);
  });
});
