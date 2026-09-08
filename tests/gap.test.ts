import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions } from "../src/engine.js";
import { gapCriterionOf, reasonFor, shortLabelOf } from "../src/verdict.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * The one-line explanation on a "within reach" card said the gap was salary,
 * whichever rule was actually missed (isolated v1-gate critique, 2026-09-08,
 * blocker 1).
 *
 * A reader who declared €50,700–€59,373 a year was told "The salary this route
 * asks for sits above the band you declared" on the Opportunity Card, whose
 * missed rule is the money she must have in the bank to live on — the rail
 * beneath the sentence said "living costs" and the banner said "monthly funds",
 * three rules in one card and only two of them the reader's. Nothing about her
 * salary is short of anything on that route.
 *
 * The sentence was a constant. It now comes from the same criterion the rail
 * and the banner are drawn on, so the three cannot disagree.
 */

const MONEY_FIELDS = dataset.fields.filter((f) => f.type === "money_band");

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/**
 * Complete profiles, drawn at random: every route reachable, every money field
 * at every band, rather than one hand-built walk that happens to hit one card.
 */
function* profiles(count: number): Generator<{ profile: Profile; where: string }> {
  const rand = lcg(20260908);
  for (let i = 0; i < count; i++) {
    const profile: Profile = {};
    for (const def of dataset.fields) {
      const values = def.type === "money_band"
        ? deriveBands(dataset, def.id).map((b) => b.id)
        : fieldOptions(dataset, def.id).map((o) => o.value);
      profile[def.id] = values[Math.floor(rand() * values.length)]!;
    }
    yield { profile, where: `profile ${i}` };
  }
}

describe("a within-reach card names the rule it is short of", () => {
  it("the sentence's rule is the criterion the gap was measured on — every route, every band", () => {
    let seen = 0;
    const routes = new Set<string>();
    for (const { profile, where } of profiles(400))
      for (const r of evaluate(dataset, profile)) {
        if (r.status !== "near" || r.gap_max === undefined) continue;
        // Short on points as well as money: the ladder is the sentence then,
        // and the points case is covered on its own below.
        if (r.gap_points !== undefined) {
          expect(reasonFor(dataset, r, profile).line, `${r.route.id} @ ${where}`).toContain("points");
          continue;
        }
        seen++;
        routes.add(r.route.id);
        const measured = gapCriterionOf(dataset, r, profile);
        expect(measured, `${r.route.id} @ ${where}: a bounded gap on no criterion`).toBeDefined();
        const said = reasonFor(dataset, r, profile).line;
        const rule = shortLabelOf(dataset, measured!.field).toLowerCase();
        expect(said, `${r.route.id} @ ${where}`).toContain(rule);
        // The card's own "up to" travels with it: the sentence a reader takes
        // away carries the distance, not just the direction.
        expect(said, `${r.route.id} @ ${where}`).toContain("Up to ");
        // And it never names a rule the reader was not measured against.
        for (const other of MONEY_FIELDS) {
          if (other.id === measured!.field) continue;
          const otherRule = shortLabelOf(dataset, other.id).toLowerCase();
          if (otherRule === rule) continue;
          expect(said, `${r.route.id} @ ${where}: names ${other.id}`).not.toContain(otherRule);
        }
      }
    expect(seen, "no near result with a bounded gap was produced at all").toBeGreaterThan(50);
    expect(routes.size, "only one route ever went within reach").toBeGreaterThan(3);
  });

  it("the Opportunity Card tells a well-paid reader about her living costs, not her salary", () => {
    // The critique's own walk: a salary far above anything Germany asks, and
    // funds below what the Chancenkarte requires to live on.
    const profile: Profile = {
      destination: "de", citizenship: "third_country", situation: "none",
      qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
      experience: "y2in5", german: "b1", salary_eur_year: "band_5",
      funds_eur_month: deriveBands(dataset, "funds_eur_month")[0]!.id,
    };
    const card = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(card.status, "the walk no longer reaches a within-reach Opportunity Card").toBe("near");
    const said = reasonFor(dataset, card, profile).line;
    expect(said).toContain(shortLabelOf(dataset, "funds_eur_month").toLowerCase());
    expect(said).not.toContain("salary");
    // The threshold's own words, where the dataset gave it any.
    const measured = gapCriterionOf(dataset, card, profile)!;
    if (measured.threshold_label) expect(said).toContain(measured.threshold_label);
  });

  it("a points route still speaks of points, not money", () => {
    const profile: Profile = {
      destination: "de", citizenship: "third_country", situation: "none",
      qualification: "vocational", recognition_de: "not_yet", occupation_shortage: "no",
      experience: "none", german: "none", funds_eur_month: "band_9", age_band: "a36to39",
    };
    for (const r of evaluate(dataset, profile))
      if (r.status === "near" && r.gap_points !== undefined)
        expect(reasonFor(dataset, r, profile).line).toContain("points");
  });
});
