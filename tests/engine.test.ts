import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { datasetMeta, deriveBands, evaluate, formatEUR, routeProvenance } from "../src/engine.js";
import { deriveQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/de.json", import.meta.url), "utf8")) as Dataset;

const seedProfile: Profile = {
  citizenship: "third_country",
  degree_recognized: "recognized",
  occupation_shortage: "yes",
  offer_de: "yes",
  salary_eur_year: "band_1", // €45,934.20 – €50,700
};

describe("band derivation (A11: band boundaries are the thresholds)", () => {
  it("derives exactly the bands the scenario names, from data", () => {
    const bands = deriveBands(dataset, "salary_eur_year");
    expect(bands.map((b) => [b.min, b.max])).toEqual([
      [undefined, 45934.2],
      [45934.2, 50700],
      [50700, undefined],
    ]);
    expect(bands[0].label).toBe("under €45,934.20");
    expect(bands[1].label).toBe("€45,934.20 – €50,700");
    expect(bands[2].label).toBe("€50,700 or more");
  });
});

describe("evaluate — seed profile of scenario S1", () => {
  const results = evaluate(dataset, seedProfile);
  const byId = Object.fromEntries(results.map((r) => [r.route.id, r]));

  it("shortage Blue Card: criteria met", () => {
    expect(byId["de-blue-card-shortage"].status).toBe("met");
  });

  it("general Blue Card: within reach with gap up to €4,766", () => {
    const r = byId["de-blue-card-general"];
    expect(r.status).toBe("near");
    expect(r.gap_max).toBeCloseTo(4765.8, 5);
    expect(formatEUR(Math.round(r.gap_max!))).toBe("€4,766");
  });

  it("met routes sort before near routes", () => {
    expect(results[0].route.id).toBe("de-blue-card-shortage");
  });
});

describe("evaluate — edge profiles", () => {
  it("top band clears both thresholds", () => {
    const results = evaluate(dataset, { ...seedProfile, salary_eur_year: "band_2" });
    expect(results.every((r) => r.status === "met")).toBe(true);
  });

  it("bottom band: shortage near (adjacent), general hold (two bands away)", () => {
    const results = evaluate(dataset, { ...seedProfile, salary_eur_year: "band_0" });
    const byId = Object.fromEntries(results.map((r) => [r.route.id, r]));
    expect(byId["de-blue-card-shortage"].status).toBe("near");
    expect(byId["de-blue-card-general"].status).toBe("hold");
  });

  it("EU citizen fails citizenship on both routes → hold", () => {
    const results = evaluate(dataset, { ...seedProfile, citizenship: "eu_eea_ch" });
    expect(results.every((r) => r.status === "hold")).toBe(true);
  });

  it("A15: 'I don't know' answers surface as unknown fields, never as met", () => {
    const results = evaluate(dataset, { ...seedProfile, occupation_shortage: "unknown" });
    const shortage = results.find((r) => r.route.id === "de-blue-card-shortage")!;
    expect(shortage.status).toBe("hold");
    expect(shortage.unknown_fields).toContain("occupation_shortage");
  });
});

describe("question derivation (questions can never desync from rules)", () => {
  it("derives one question per referenced field, salary options from thresholds", () => {
    const qs = deriveQuestions(dataset);
    expect(qs.map((q) => q.field)).toEqual([
      "citizenship", "degree_recognized", "occupation_shortage", "offer_de", "salary_eur_year",
    ]);
    const salary = qs.find((q) => q.field === "salary_eur_year")!;
    expect(salary.options.map((o) => o.label)).toEqual([
      "under €45,934.20", "€45,934.20 – €50,700", "€50,700 or more",
    ]);
  });

  it("scenario step 5: changing a threshold changes the options with no code change", () => {
    const mutated = structuredClone(dataset);
    const general = mutated.countries[0].routes
      .find((r) => r.id === "de-blue-card-general")!
      .criteria.find((c) => c.op === "gte")!;
    if (general.op === "gte") general.threshold.amount = 52000;
    const salary = deriveQuestions(mutated).find((q) => q.field === "salary_eur_year")!;
    expect(salary.options.map((o) => o.label)).toEqual([
      "under €45,934.20", "€45,934.20 – €52,000", "€52,000 or more",
    ]);
  });
});

describe("provenance and meta", () => {
  it("every threshold carries quote + source + retrieval date", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        for (const p of routeProvenance(route)) {
          expect(p.value.quote.length).toBeGreaterThan(4);
          expect(p.value.source_url).toMatch(/^https:\/\//);
          expect(p.value.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
  });

  it("meta reports newest retrieved_at for the health line", () => {
    expect(datasetMeta(dataset)).toEqual({
      schema_version: "0.1.0",
      dataset_version: "2026.09.01",
      newest_retrieved_at: "2026-09-01",
    });
  });
});
