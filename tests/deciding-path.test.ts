import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decidingCriteria, deriveBands, evaluate, resultProvenance } from "../src/engine.js";
import type { CriterionResult, Dataset, Profile, RouteResult } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** The band a euro figure falls in — band ids shift whenever a threshold is
 * added, and a test that names a number should not have to know that. */
function bandFor(field: string, amount: number): string {
  return deriveBands(dataset, field).find(
    (b) => (b.min === undefined || amount >= b.min) && (b.max === undefined || amount < b.max),
  )!.id;
}

/**
 * The profile a person walked in with (human catch, 2026-09-07): third-country
 * passport, an offer in the Netherlands, under 30, a university degree, a
 * declared band of €3,122–€4,357 a month, and a Dutch degree from the last
 * three years. The card said CRITERIA MET and drew a rail labelled €4,357 with
 * his band below the line — one card showing a verdict and a picture of the
 * same man failing.
 */
const dutchGraduate: Profile = {
  destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree",
  age_band: "u30", nl_recent_grad: "yes", top200_grad: "no", occupation_it: "no",
  salary_eur_month: bandFor("salary_eur_month", 3500),
};

const resultOf = (profile: Profile, id: string): RouteResult =>
  evaluate(dataset, profile).find((r) => r.route.id === id)!;

/** The thresholds the outcome actually rested on, in dataset order. */
const appliedAmounts = (r: RouteResult): number[] =>
  decidingCriteria(r.criteria).flatMap((cr) => (cr.criterion.op === "gte" ? [cr.criterion.threshold.amount] : []));

/** The quoted amounts a card lists, each marked with whether it applied. */
const thresholdEntries = (r: RouteResult) =>
  resultProvenance(r, {}).filter((e) => e.amount !== undefined);

/** The route's salary disjunction, whichever position it sits in. */
const salaryOf = (r: RouteResult): CriterionResult =>
  r.criteria.find((cr) => cr.criterion.op === "any" && cr.criterion.label === "the salary this route asks for")!;

describe("a card names the threshold it was actually measured against", () => {
  it("met through the reduced path: the threshold that applied is €3,122, never €4,357", () => {
    const r = resultOf(dutchGraduate, "nl-hsm-under30");
    expect(r.status).toBe("met");
    expect(appliedAmounts(r)).toEqual([3122]);
  });

  it("the deciding path names itself, so the rail can caption it", () => {
    expect(salaryOf(resultOf(dutchGraduate, "nl-hsm-under30")).path?.label)
      .toBe("the lower salary for a recent graduate");
  });

  it("both quotes still render, and exactly one is marked as the one that applied", () => {
    const entries = thresholdEntries(resultOf(dutchGraduate, "nl-hsm-under30"));
    // The reader may want to know the other threshold exists — it must simply
    // never be mistaken for theirs.
    expect(entries.map((e) => e.amount).sort((a, b) => a! - b!)).toEqual([3122, 4357]);
    expect(entries.filter((e) => e.applied).map((e) => e.amount)).toEqual([3122]);
  });

  it("not met, reduced path out of reach: the nearest reachable threshold is the one that applied", () => {
    const r = resultOf({ ...dutchGraduate, nl_recent_grad: "no" }, "nl-hsm-under30");
    expect(r.status).toBe("near");
    expect(appliedAmounts(r)).toEqual([4357]);
    expect(thresholdEntries(r).filter((e) => e.applied).map((e) => e.amount)).toEqual([4357]);
  });

  it("not met on the reduced path itself: that is the threshold the gap was measured to", () => {
    const r = resultOf(
      { ...dutchGraduate, salary_eur_month: bandFor("salary_eur_month", 2000) },
      "nl-hsm-under30",
    );
    expect(r.status).toBe("near");
    expect(appliedAmounts(r)).toEqual([3122]);
    expect(r.gap_max).toBeCloseTo(3122 - 1867.02, 2);
  });

  it("nothing decided yet: no path is claimed, and no quote is marked either way", () => {
    // "I don't know" about the designated list leaves the reduced path open —
    // and a threshold nobody has been measured against yet must be neither
    // claimed for the reader NOR ruled out.
    const r = resultOf({ ...dutchGraduate, nl_recent_grad: "no", top200_grad: "unknown" }, "nl-hsm-under30");
    expect(r.status).toBe("hold");
    expect(salaryOf(r).path).toBeUndefined();
    expect(thresholdEntries(r).map((e) => e.applied)).toEqual([undefined, undefined]);
  });

  it("the salary unanswered: an undecided route rules neither threshold out", () => {
    // The scenario's own step 5 — "I don't know wherever it is offered" — with
    // the salary question not yet reached. `applied` was one boolean carrying
    // two notions, LOST and NOT YET DECIDED, and an undecided disjunction
    // contributes nothing to the deciding set: both quotes came back false and
    // the card printed "does not apply to you" under each of them, to a person
    // who had been ruled out of nothing (review 2026-09-07).
    const r = resultOf({
      destination: "nl", citizenship: "third_country", situation: "offer",
      age_band: "u30", qualification: "degree", experience: "y2in5",
    }, "nl-hsm-under30");
    expect(r.status).toBe("hold");
    expect(thresholdEntries(r).map((e) => e.amount).sort((a, b) => a! - b!)).toEqual([3122, 4357]);
    expect(thresholdEntries(r).map((e) => e.applied)).toEqual([undefined, undefined]);
  });

  it("a criterion outside any disjunction is always its own decider", () => {
    const r = resultOf(dutchGraduate, "nl-hsm-under30");
    const decided = decidingCriteria(r.criteria).map((cr) => cr.criterion);
    expect(decided).toContain(r.route.criteria[0]); // citizenship, stated flat
  });

  it("a mark is one of the three states, on every route and every profile", () => {
    // Whatever the profile, the deciding walk can only ever return nodes the
    // dataset wrote — never a synthesised one.
    for (const profile of [dutchGraduate, { ...dutchGraduate, nl_recent_grad: "no" }, {}])
      for (const r of evaluate(dataset, profile))
        for (const entry of resultProvenance(r, {}))
          expect([true, false, undefined], r.route.id).toContain(entry.applied);
  });

  it("before a single answer, no card rules anything out", () => {
    // The strong form: nothing has decided anything on an empty interview, so
    // no value anywhere may carry the ruled-out mark.
    for (const r of evaluate(dataset, {}))
      for (const entry of resultProvenance(r, {}))
        expect(entry.applied, `${r.route.id}: ${entry.label ?? entry.value.quote.slice(0, 40)}`)
          .not.toBe(false);
  });
});
