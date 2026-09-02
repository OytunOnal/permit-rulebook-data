import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { datasetMeta, deriveBands, evaluate, formatEUR, routeProvenance } from "../src/engine.js";
import { deriveQuestions, remainingQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/de.json", import.meta.url), "utf8")) as Dataset;

// Salary bands: <45,630 / 45,630–45,934.20 / 45,934.20–50,700 / ≥50,700
const engineer: Profile = {
  citizenship: "third_country", situation: "offer_de", qualification: "degree",
  recognition_de: "recognized", occupation_shortage: "yes", experience: "y2in5",
  salary_eur_year: "band_2",
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

describe("band derivation across three salary thresholds", () => {
  it("derives four bands whose edges are exactly the thresholds", () => {
    const bands = deriveBands(dataset, "salary_eur_year");
    expect(bands.map((b) => [b.min, b.max])).toEqual([
      [undefined, 45630], [45630, 45934.2], [45934.2, 50700], [50700, undefined],
    ]);
    expect(bands[2].label).toBe("€45,934.20 – €50,700");
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
  it("P1 engineer with offer: at most 7 questions, occupation_it never asked", () => {
    const { asked } = runFlow(engineer);
    expect(asked.length).toBeLessThanOrEqual(7);
    expect(asked).not.toContain("occupation_it");
    expect(asked).not.toContain("german"); // Chancenkarte dead → no points ladder
  });

  it("P2 vocational worker with offer: at most 7 questions, shortage list never asked", () => {
    const { asked, profile } = runFlow({
      citizenship: "third_country", situation: "offer_de", qualification: "vocational",
      recognition_de: "recognized", experience: "y5in7", salary_eur_year: "band_1",
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
      citizenship: "third_country", situation: "none", qualification: "degree",
      language_base: "yes", funds_eur_month: "band_1", recognition_de: "not_yet",
      german: "b1", english_c1: "no", experience: "lt2", occupation_shortage: "no",
      age_band: "u35", de_stay6m: "no", partner_ck: "no",
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
      citizenship: "eu_eea_ch", situation: "offer_de", qualification: "degree",
      recognition_de: "recognized", experience: "y2in5",
    });
    expect(asked.length).toBeLessThanOrEqual(4);
    expect(asked).toContain("citizenship");
  });

  it("fully recognised explorer passes Chancenkarte directly — points ladder skipped", () => {
    const profile: Profile = {
      citizenship: "third_country", situation: "none", qualification: "degree",
      language_base: "yes", funds_eur_month: "band_1", recognition_de: "recognized",
    };
    expect(remainingQuestions(dataset, profile)).toEqual([]);
    const ck = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    expect(ck.status).toBe("met");
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
