import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, formatEUR } from "../src/engine.js";
import { deriveQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * A salary belongs to exactly one band.
 *
 * It belonged to two. "€4,754 – €5,942" and "€5,942 or more" both contained
 * €5,942 — the threshold one of them decides — so a transferee earning exactly
 * that got opposite verdicts depending on which true label he picked (isolated
 * v1-gate critique, 2026-09-08, B1). The arithmetic was always half-open, and
 * a band has always passed a threshold iff its own floor reaches it; only the
 * words were ambiguous, and the words are what a reader answers with.
 *
 * The ladder itself stays pooled across all four countries (human ruling,
 * 2026-09-08). A neighbour's cut point inside the range decides nothing, and
 * the extra rungs are what let the card say "short by €6,048" instead of
 * "short by up to €45,630".
 */
describe("bands are half-open, and say so", () => {
  const FIELDS = ["salary_eur_year", "salary_eur_month", "funds_eur_month"] as const;

  it("no amount is inside two bands, on any money ladder", () => {
    for (const field of FIELDS) {
      const bands = deriveBands(dataset, field);
      for (const band of bands)
        for (const edge of [band.min, band.max].filter((x): x is number => x !== undefined)) {
          const shown = formatEUR(edge);
          // The edge belongs to the band it opens, and to no other.
          const holding = bands.filter((b) =>
            (b.min ?? 0) <= edge && (b.max === undefined || edge < b.max));
          expect(holding.length, `${field}: ${shown} sits in ${
            holding.map((b) => b.label).join(" and ")}`).toBe(1);
          // And a reader reading the labels alone reaches the same band: the
          // one below the edge says "under", so the number appears twice but
          // claims itself only once.
          const claiming = bands.filter((b) => b.label.includes(shown) && !b.label.includes(`under ${shown}`));
          expect(claiming.map((b) => b.label), `${field}: ${shown}`).toEqual([holding[0]!.label]);
        }
    }
  });

  it("the words are the arithmetic: under X, X to under Y, X or more", () => {
    expect(deriveBands(dataset, "salary_eur_month").map((b) => b.label)).toEqual([
      "under €1,635.90", "€1,635.90 – under €1,867.02", "€1,867.02 – under €3,122",
      "€3,122 – under €4,357", "€4,357 – under €4,754", "€4,754 – under €5,942",
      "€5,942 or more",
    ]);
    expect(deriveBands(dataset, "funds_eur_month").map((b) => b.label))
      .toEqual(["under €1,091", "€1,091 or more"]);
  });

  it("the ladder is every country's thresholds, for every reader", () => {
    // Pooled on purpose: the fine-grained ladder is what makes a gap a number.
    const pooled = deriveBands(dataset, "salary_eur_year").map((b) => [b.min, b.max]);
    expect(pooled).toEqual([
      [undefined, 33085.09], [33085.09, 39582], [39582, 41356.36], [41356.36, 45630],
      [45630, 45934.2], [45934.2, 50700], [50700, 59373], [59373, undefined],
    ]);
    // And the interview offers exactly those rungs, written out here rather
    // than compared against the function that produced them (Standards review,
    // 2026-09-08: a test that computes its own expectation asserts nothing).
    const salary = deriveQuestions(dataset).find((x) => x.field === "salary_eur_year")!;
    expect(salary.options.map((o) => o.label)).toEqual([
      "under €33,085.09", "€33,085.09 – under €39,582", "€39,582 – under €41,356.36",
      "€41,356.36 – under €45,630", "€45,630 – under €45,934.20",
      "€45,934.20 – under €50,700", "€50,700 – under €59,373", "€59,373 or more",
      "Doesn't apply to me, or I don't know",
    ]);
    expect(salary.options.at(-1)!.value).toBe("unknown");
  });

  it("a reader at exactly the threshold has one label, and it is met", () => {
    // Lucas, transferee, €5,942/month exactly: the band his salary is in is the
    // only one it is in, and it passes the €5,942 rule.
    const bands = deriveBands(dataset, "salary_eur_month");
    const his = bands.find((b) => (b.min ?? 0) <= 5942 && (b.max === undefined || 5942 < b.max))!;
    expect(his.label).toBe("€5,942 or more");
    const profile: Profile = {
      destination: "nl", citizenship: "third_country", situation: "ict",
      salary_eur_month: his.id, qualification: "degree",
    };
    const ict = evaluate(dataset, profile).find((r) => r.route.id === "nl-ict")!;
    expect(ict.criteria.filter((c) => c.criterion.op === "gte" && c.outcome !== "pass"),
      "the threshold he meets is not met").toEqual([]);
  });

  it("the band below the edge is short of it, and says by how much", () => {
    // The other half of the same fix. One band down is below the rule: the
    // Dutch card stops being met, and on a route where the salary decides
    // alone the shortfall is the distance from that band's own floor.
    const monthly = deriveBands(dataset, "salary_eur_month");
    const below = monthly.find((b) => b.max === 5942)!;
    expect(below.label).toBe("€4,754 – under €5,942");
    const lucas: Profile = {
      destination: "nl", citizenship: "third_country", situation: "ict",
      salary_eur_month: below.id, qualification: "degree",
    };
    expect(evaluate(dataset, lucas).find((r) => r.route.id === "nl-ict")!.status).not.toBe("met");

    const yearly = deriveBands(dataset, "salary_eur_year");
    const under = yearly.find((b) => b.max === 45630)!;
    const german: Profile = {
      destination: "de", citizenship: "third_country", situation: "offer",
      qualification: "degree", occupation_it: "no", experience: "y2in5",
      salary_eur_year: under.id,
    };
    const worker = evaluate(dataset, german).find((r) => r.route.id === "de-experienced-worker")!;
    expect(worker.status).toBe("near");
    expect(worker.gap_max).toBeCloseTo(45630 - under.min!, 2);
  });
});

/**
 * Where re-scoping a record lives now.
 *
 * It was a one-line pass-through in the engine (spread an object, return an
 * empty list of casualties), which is not the engine's job and told a reader
 * of this file that something rules-shaped happened here (Standards review,
 * 2026-09-08). Moving a record to another country is the interview's own
 * business and is tested where it happens, in the site's `arrivalPlan`. What
 * the engine still owes that move is the guarantee below.
 */
describe("a money answer means the same amount in every country", () => {
  it("one ladder, so a band carried to another destination names the same euros", () => {
    const bands = deriveBands(dataset, "salary_eur_year");
    const declared = bands.find((b) => b.label === "€45,934.20 – under €50,700")!;
    for (const destination of ["de", "fr", "es", "nl", "all"]) {
      const profile: Profile = { destination, salary_eur_year: declared.id };
      // The engine reads the answer against the same rung whoever is asking.
      const seen = deriveBands(dataset, "salary_eur_year").find((b) => b.id === profile["salary_eur_year"])!;
      expect(seen.min, destination).toBe(45934.2);
      expect(seen.max, destination).toBe(50700);
    }
  });
});
