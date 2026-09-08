import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, unlocks } from "../src/engine.js";
import { unlockTitleOf } from "../src/verdict.js";
import { remainingQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

// Explorer with strong credentials: everything is there except a situation.
const explorer: Profile = {
  destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
  recognition_de: "recognized", occupation_shortage: "yes", experience: "y2in5",
  german: "b1", funds_eur_month: "band_1",
  // salary answered so the offer counterfactual can evaluate fully
  // (band_5 = €45,934.20 – under €50,700: clears shortage BC + §19c, below the
  // general BC)
  salary_eur_year: "band_5",
};

describe("unlocks — counterfactual leverage over path fields", () => {
  const result = unlocks(dataset, explorer);
  const byOption = Object.fromEntries(result.map((u) => [u.option.value, u]));

  it("one row per alternative situation, fallback ('none') never a target", () => {
    expect(Object.keys(byOption).sort()).toEqual(["ict", "offer", "research"]);
  });

  it("a job offer unlocks the offer-gated routes with honest statuses", () => {
    const ids = Object.fromEntries(byOption["offer"].routes.map((r) => [r.route.id, r.status]));
    expect(ids["de-skilled-academic"]).toBe("met");
    expect(ids["de-blue-card-shortage"]).toBe("met");
    expect(ids["de-experienced-worker"]).toBe("met");
    expect(ids["de-blue-card-general"]).toBe("near");
  });

  it("transfer unlocks only the ICT card; hosting only the researcher permit", () => {
    expect(byOption["ict"].routes.map((r) => r.route.id)).toEqual(["de-ict-card"]);
    expect(byOption["research"].routes.map((r) => r.route.id)).toEqual(["de-researcher"]);
  });

  it("an offer-holder gets no unlock section (no 'give up your offer' advice)", () => {
    const withOffer: Profile = { ...explorer, situation: "offer" };
    // ict/research counterfactuals would open ICT/researcher — those are real
    // alternatives and may appear; but the fallback 'none' must never appear.
    expect(unlocks(dataset, withOffer).every((u) => u.option.value !== "none")).toBe(true);
  });

  it("attribute fields are never counterfactualed", () => {
    // Only 'situation' is kind:path in the dataset, so every unlock row is on it.
    expect(unlocks(dataset, explorer).every((u) => u.field === "situation")).toBe(true);
  });

  it("unanswered path fields produce no rows", () => {
    expect(unlocks(dataset, { citizenship: "third_country" })).toEqual([]);
  });
});

describe("unlocks — improvable fields (language, funds, recognition…)", () => {
  // Fully answered, language-less explorer: base-language any fails on both
  // paths; points would be 5 of 6 (experience 2 + shortage 1 + age 2).
  const languageless: Profile = {
    destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
    recognition_de: "not_yet", german: "none", english: "none",
    experience: "y2in5", occupation_shortage: "yes", age_band: "a30to35",
    de_stay6m: "no", partner_ck: "no", funds_eur_month: "band_1",
  };
  const rows = unlocks(dataset, languageless);
  const by = (f: string, v: string) => rows.find((u) => u.field === f && u.option.value === v);

  it("learning German A1 (0 points) still unlocks: base met, points 1 short → near", () => {
    const u = by("german", "a1")!;
    expect(u.routes.map((r) => [r.route.id, r.status])).toEqual([["de-chancenkarte", "near"]]);
    expect(u.routes[0].gap_points).toBe(1);
  });

  it("German A2 unlocks fully: base met and 6th point scored", () => {
    expect(by("german", "a2")!.routes[0].status).toBe("met");
  });

  it("English B2 → near (base only), C1 → met (base + bonus point)", () => {
    expect(by("english", "b2")!.routes[0].status).toBe("near");
    expect(by("english", "c1")!.routes[0].status).toBe("met");
  });

  it("recognition alone shows nothing — base language would still fail (single-step honesty)", () => {
    expect(rows.some((u) => u.field === "recognition_de")).toBe(false);
  });

  it("no downgrade rows: salary and funds never suggest a lower band", () => {
    expect(rows.some((u) => u.field === "funds_eur_month")).toBe(false);
  });
});

describe("improvable fails keep the interview alive (user-reported: no-language explorer saw no language steps)", () => {
  // The user's exact shape: degree, recognition unknown, no language at all.
  const early: Profile = {
    destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
    recognition_de: "unknown", experience: "lt2", occupation_shortage: "yes",
    german: "none", english: "none",
  };

  it("funds/age/etc are still asked — the language fail didn't kill Chancenkarte", () => {
    const remaining = remainingQuestions(dataset, early).map((q) => q.field);
    expect(remaining).toEqual(expect.arrayContaining(["funds_eur_month", "age_band"]));
  });

  it("with the full picture, 'German B2' becomes a provable unlock even with recognition unknown", () => {
    const full: Profile = {
      ...early, funds_eur_month: "band_1", age_band: "a30to35",
      de_stay6m: "no", partner_ck: "no",
    };
    const rows2 = unlocks(dataset, full);
    const b2 = rows2.find((u) => u.field === "german" && u.option.value === "b2plus")!;
    // shortage 1 + age 2 + German B2 3 = 6 → points pass regardless of the open unknown
    expect(b2.routes.map((r) => [r.route.id, r.status])).toEqual([["de-chancenkarte", "met"]]);
    // English C1 alone (1+2+1=4) proves nothing while recognition is unknown → honest absence
    expect(rows2.some((u) => u.field === "english" && u.option.value === "c1")).toBe(false);
  });
});

/**
 * A ladder is not a list of steps.
 *
 * With three answers of "I don't know" the rail printed thirteen steps, ten of
 * them the salary and funds ladders one rung at a time and eight of those
 * naming the same route — the first of them offering "under €33,085.09", which
 * is a step downwards (isolated v1-gate critique, 2026-09-08, B3). A number is
 * one decision, so it earns one step: the nearest rung that changes a verdict.
 */
describe("a numeric field earns one step, never a rung-by-rung enumeration", () => {
  // Arun, answering "I don't know" to the three questions the product itself
  // invites him to be unsure about.
  const unsure: Profile = {
    destination: "de", citizenship: "IN", situation: "offer", qualification: "degree",
    occupation_shortage: "unknown", recognition_de: "unknown", salary_eur_year: "unknown",
    experience: "y3in7", german: "b1", english: "c1", age_band: "a30to35",
    de_stay6m: "no", partner_ck: "no", funds_eur_month: "band_1",
  };

  it("one salary step, and it is the nearest rung that opens something", () => {
    const rows = unlocks(dataset, unsure);
    const salary = rows.filter((u) => u.field === "salary_eur_year");
    expect(salary.length, salary.map((u) => u.option.label).join(" | ")).toBe(1);
    // €45,630 is the lowest German threshold this reader is short of, and the
    // route it opens is the one the card would name.
    expect(salary[0]!.option.label).toBe("€45,630 – under €45,934.20");
    expect(salary[0]!.routes.map((r) => [r.route.id, r.status])).toEqual([["de-experienced-worker", "met"]]);
  });

  it("no step ever moves a money answer downwards", () => {
    for (const profile of [unsure, { ...unsure, salary_eur_year: "band_4" }, { ...unsure, salary_eur_year: "band_5" }]) {
      const declared = deriveBands(dataset, "salary_eur_year").find((b) => b.id === profile["salary_eur_year"]);
      for (const u of unlocks(dataset, profile).filter((x) => x.field === "salary_eur_year")) {
        const step = deriveBands(dataset, "salary_eur_year").find((b) => b.id === u.option.value)!;
        expect(step.min, `${u.option.label} is not above ${declared?.label ?? "an unknown amount"}`)
          .toBeGreaterThan(declared?.min ?? 0);
      }
    }
  });

  it("the headline counts what survives", () => {
    // Three real steps — a transfer, a hosting agreement, recognition — and one
    // salary step, where the rail used to print seven rows for this reader.
    expect(unlocks(dataset, unsure).length).toBe(4);
  });

  it("the step says the gap the card computes, and the amount when there is no gap to state", () => {
    // A reader who declared €45,630 – under €45,934.20: the general Blue Card
    // is within reach at €50,700, and closing that distance is the step.
    const declared: Profile = {
      destination: "de", citizenship: "IN", situation: "offer", qualification: "degree",
      recognition_de: "recognized", occupation_shortage: "no", experience: "y3in7",
      german: "b1", english: "c1", age_band: "a30to35", de_stay6m: "no", partner_ck: "no",
      // €45,630 – under €45,934.20 on the pooled ladder.
      funds_eur_month: "band_1", salary_eur_year: "band_4",
    };
    const step = unlocks(dataset, declared).find((u) => u.field === "salary_eur_year")!;
    expect(unlockTitleOf(dataset, step, declared)).toBe("€5,070/year more — yearly salary");
    expect(step.routes.map((r) => [r.route.id, r.status])).toEqual([["de-blue-card-general", "met"]]);
    // With no floor declared — "I don't know" — there is no distance to state,
    // so the step is the amount the rule asks for.
    const step2 = unlocks(dataset, unsure).find((u) => u.field === "salary_eur_year")!;
    expect(unlockTitleOf(dataset, step2, unsure)).toBe("at least €45,630/year — yearly salary");
  });
});
