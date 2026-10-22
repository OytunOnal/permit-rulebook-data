import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  deriveBands, evaluate, formatEURPer, gapCriterionOf, reasonFor, unlockTitleOf, unlocks,
  type Dataset, type Profile,
} from "../src/index.js";

/**
 * A gap is said one way (#174; rulings 3 and 11 on #55).
 *
 * The card's one-line explanation and a money step's title print a gap the
 * way the site's headline, gap note and rail do: exact, cents only where it
 * has them, with its period — rounded, "up to" understated it. A band open at
 * the bottom has no lower edge to measure a gap from, so the sentence names
 * the line the route asks, never that line as the reader's shortfall.
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
const bands = deriveBands(dataset, SALARY);

/** The one route within reach on a money gap, its sentence, and the threshold it was measured against. */
function nearOn(answers: Profile) {
  const near = evaluate(dataset, answers).filter((r) => r.status === "near" && r.gap_max !== undefined);
  expect(near.length, "precondition: one route within reach on a money gap").toBe(1);
  const r = near[0]!;
  return { line: reasonFor(dataset, r, answers).line, threshold: gapCriterionOf(dataset, r, answers)!.threshold.amount };
}

describe("the card's sentence says a gap exactly, or the line", () => {
  it("a bounded band with a gap in cents prints its cents and its period", () => {
    // €41,356.36 – under €45,630, measured against €45,630: €4,273.64 short at most.
    const band = bands.find((b) => b.min === 41356.36)!;
    const { line, threshold } = nearOn({ ...HOSTILE, [SALARY]: band.id });
    expect(threshold).toBe(45630);
    expect(line).toContain("Up to €4,273.64/year short");
  });

  it("the lowest band names the line the route asks, and never says up to", () => {
    const lowest = bands.find((b) => b.min === undefined)!;
    const { line, threshold } = nearOn({ ...HOSTILE, [SALARY]: lowest.id });
    expect(line).toContain(`Needs ${formatEURPer(threshold, "year")} or more`);
    expect(line).not.toMatch(/up to/i);
    expect(line).not.toMatch(/short/i);
  });
});

describe("a money step's amount is exact", () => {
  it("the distance from the declared band's floor to the step's, with its cents", () => {
    // A recognised graduate on €41,356.36 – under €45,630: the step to €45,630
    // is €4,273.64 more, not €4,274.
    const declared: Profile = {
      destination: "de", citizenship: "IN", situation: "offer", qualification: "degree",
      recognition_de: "recognized", occupation_shortage: "no", experience_5y: "2plus", experience_7y: "3to5",
      german: "b1", english: "c1", age_band: "a30to35", de_stay6m: "no", partner_ck: "no",
      funds_eur_month: "band_1", [SALARY]: bands.find((b) => b.min === 41356.36)!.id,
    };
    const titles = unlocks(dataset, declared).filter((u) => u.field === SALARY)
      .map((u) => unlockTitleOf(dataset, u, declared));
    expect(titles).toContain("€4,273.64/year more — yearly salary");
  });
});
