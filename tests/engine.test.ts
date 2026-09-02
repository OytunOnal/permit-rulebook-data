import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { datasetMeta, deriveBands, evaluate, formatEUR, routeProvenance } from "../src/engine.js";
import { deriveQuestions, remainingQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

// Annual salary bands (all four countries' thresholds): <39,582 / 39,582–41,356.36 /
// 41,356.36–45,630 / 45,630–45,934.20 / 45,934.20–50,700 / 50,700–59,373 / ≥59,373
const engineer: Profile = {
  destination: "de", citizenship: "third_country", situation: "offer", qualification: "degree",
  recognition_de: "recognized", occupation_shortage: "yes", experience: "y2in5",
  salary_eur_year: "band_4",
};

/** Greedy wizard simulation: always answer the first remaining question. */
function runFlow(answers: Profile): { asked: string[]; profile: Profile } {
  const profile: Profile = {};
  const asked: string[] = [];
  for (let i = 0; i < 50; i++) {
    const remaining = remainingQuestions(dataset, profile);
    if (remaining.length === 0) break;
    const q = remaining[0];
    if (answers[q.field] === undefined) throw new Error(`persona has no answer for ${q.field}`);
    asked.push(q.field);
    profile[q.field] = answers[q.field];
  }
  return { asked, profile };
}

describe("band derivation across the four countries' salary thresholds", () => {
  it("derives seven bands whose edges are exactly the thresholds", () => {
    const bands = deriveBands(dataset, "salary_eur_year");
    expect(bands.map((b) => [b.min, b.max])).toEqual([
      [undefined, 39582], [39582, 41356.36], [41356.36, 45630], [45630, 45934.2],
      [45934.2, 50700], [50700, 59373], [59373, undefined],
    ]);
    expect(bands[4].label).toBe("€45,934.20 – €50,700");
  });

  it("monthly salary bands include thresholds nested inside any-paths (NL ICT)", () => {
    expect(deriveBands(dataset, "salary_eur_month").map((b) => [b.min, b.max])).toEqual([
      [undefined, 1635.9], [1635.9, 1867.02], [1867.02, 4357], [4357, 5942], [5942, undefined],
    ]);
  });

  it("funds field gets its own independent band set", () => {
    expect(deriveBands(dataset, "funds_eur_month").map((b) => [b.min, b.max])).toEqual([
      [undefined, 1091], [1091, undefined],
    ]);
  });
});

describe("evaluate — engineer with a German offer", () => {
  const byId = Object.fromEntries(evaluate(dataset, engineer).map((r) => [r.route.id, r]));

  it("shortage Blue Card, §18b and §19c all met", () => {
    expect(byId["de-blue-card-shortage"].status).toBe("met");
    expect(byId["de-skilled-academic"].status).toBe("met");
    expect(byId["de-experienced-worker"].status).toBe("met");
  });

  it("general Blue Card within reach with the €4,766 gap", () => {
    expect(byId["de-blue-card-general"].status).toBe("near");
    expect(formatEUR(Math.round(byId["de-blue-card-general"].gap_max!))).toBe("€4,766");
  });

  it("situational routes (research, ICT, Chancenkarte) are hold", () => {
    expect(byId["de-researcher"].status).toBe("hold");
    expect(byId["de-ict-card"].status).toBe("hold");
    expect(byId["de-chancenkarte"].status).toBe("hold");
  });
});

describe("scenario step 4 — personas reach a verdict in few questions", () => {
  it("P1 engineer with offer: at most 8 questions (destination included), occupation_it never asked", () => {
    const { asked } = runFlow(engineer);
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(asked).not.toContain("occupation_it");
    expect(asked).not.toContain("german"); // Chancenkarte dead → no points ladder
  });

  it("P2 vocational worker with offer: at most 7 questions, shortage list never asked", () => {
    const { asked, profile } = runFlow({
      destination: "de", citizenship: "third_country", situation: "offer", qualification: "vocational",
      recognition_de: "recognized", experience: "y5in7", salary_eur_year: "band_3",
      occupation_shortage: "no", occupation_it: "no",
    });
    expect(asked.length).toBeLessThanOrEqual(7);
    expect(asked).not.toContain("occupation_shortage"); // only Blue Card wants it, and Blue Card is dead
    const byId = Object.fromEntries(evaluate(dataset, profile).map((r) => [r.route.id, r]));
    expect(byId["de-skilled-vocational"].status).toBe("met");
    expect(byId["de-experienced-worker"].status).toBe("met");
  });

  it("P3 explorer without offer: only Chancenkarte questions come, salary never asked (A10 measurement)", () => {
    const { asked, profile } = runFlow({
      destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
      funds_eur_month: "band_1", recognition_de: "not_yet",
      german: "b1", english: "none", experience: "lt2", occupation_shortage: "no",
      age_band: "a30to35", de_stay6m: "no", partner_ck: "no",
    });
    expect(asked).not.toContain("salary_eur_year");
    expect(asked.length).toBeGreaterThanOrEqual(8); // honest: the points ladder is long
    expect(asked.length).toBeLessThanOrEqual(13);
    const ck = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(ck.status).toBe("near");
    expect(ck.gap_points).toBe(2); // B1 (2) + age (2) = 4 of 6
  });
});

describe("pruning at dataset scale", () => {
  it("EU citizen: the citizenship answer ends the questionnaire within a few questions", () => {
    const { asked } = runFlow({
      destination: "de", citizenship: "eu_eea_ch", situation: "offer", qualification: "degree",
      recognition_de: "recognized", experience: "y2in5",
    });
    expect(asked.length).toBeLessThanOrEqual(5);
    expect(asked).toContain("citizenship");
  });

  it("fully recognised explorer passes Chancenkarte directly — points ladder skipped", () => {
    const profile: Profile = {
      destination: "de", citizenship: "third_country", situation: "none", qualification: "degree",
      german: "a1", funds_eur_month: "band_1", recognition_de: "recognized",
    };
    expect(remainingQuestions(dataset, profile)).toEqual([]);
    const ck = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(ck.status).toBe("met");
  });
});

describe("bounded gaps don't end the interview (user-reported: funds under €1,091)", () => {
  it("explorer with low funds still gets the full Chancenkarte interview → within reach", () => {
    const { asked, profile } = runFlow({
      destination: "de", citizenship: "third_country", situation: "none", funds_eur_month: "band_0",
      qualification: "degree", recognition_de: "recognized", german: "a1",
      english: "none", experience: "y2in5", occupation_shortage: "no",
      age_band: "a30to35", de_stay6m: "no", partner_ck: "no",
    });
    expect(asked).toContain("qualification"); // interview continued past the funds gap
    const ck = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(ck.status).toBe("near");
    expect(ck.gap_max).toBe(1091);
  });

  it("a hard fail still ends it: no qualification kills Chancenkarte for real", () => {
    const { profile } = runFlow({
      destination: "de", citizenship: "third_country", situation: "none", funds_eur_month: "band_0",
      qualification: "none",
    });
    const ck = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(ck.status).toBe("hold");
  });
});

describe("questions derive from rules", () => {
  it("every dataset field is referenced and becomes a question", () => {
    expect(deriveQuestions(dataset).length).toBe(dataset.fields.length);
  });

  it("scenario step 5: changing a threshold changes the options with no code change", () => {
    const mutated = structuredClone(dataset);
    for (const route of mutated.countries[0].routes)
      for (const c of route.criteria)
        if (c.op === "gte" && c.threshold.amount === 50700) c.threshold.amount = 52000;
    const salary = deriveQuestions(mutated).find((q) => q.field === "salary_eur_year")!;
    expect(salary.options.map((o) => o.label)).toContain("€45,934.20 – €52,000");
  });
});

describe("learn sources (s3: 'I don't know' → find out officially)", () => {
  it("unknown-capable fields carry an official learn link", () => {
    for (const id of ["recognition_de", "occupation_shortage"]) {
      const def = dataset.fields.find((f) => f.id === id)!;
      expect(def.learn?.url).toMatch(/^https:\/\//);
      expect(def.learn?.label.length).toBeGreaterThan(5);
    }
  });
});

describe("provenance and meta", () => {
  it("every provenanced value carries quote + https source + date", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        for (const p of routeProvenance(route)) {
          expect(p.value.quote.length).toBeGreaterThan(4);
          expect(p.value.source_url).toMatch(/^https:\/\//);
          expect(p.value.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
  });

  it("meta reports the newest retrieved_at across all value kinds", () => {
    expect(datasetMeta(dataset)).toEqual({
      schema_version: "0.1.0",
      dataset_version: "2026.09.02",
      newest_retrieved_at: "2026-09-02",
    });
  });
});
