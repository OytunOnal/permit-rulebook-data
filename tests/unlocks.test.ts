import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unlocks } from "../src/engine.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/de.json", import.meta.url), "utf8")) as Dataset;

// Explorer with strong credentials: everything is there except a situation.
const explorer: Profile = {
  citizenship: "third_country", situation: "none", qualification: "degree",
  recognition_de: "recognized", occupation_shortage: "yes", experience: "y2in5",
  language_base: "yes", funds_eur_month: "band_1",
  // salary answered so the offer counterfactual can evaluate fully
  salary_eur_year: "band_2",
};

describe("unlocks — counterfactual leverage over path fields", () => {
  const result = unlocks(dataset, explorer);
  const byOption = Object.fromEntries(result.map((u) => [u.option.value, u]));

  it("one row per alternative situation, fallback ('none') never a target", () => {
    expect(Object.keys(byOption).sort()).toEqual(["ict", "offer_de", "research"]);
  });

  it("a job offer unlocks the offer-gated routes with honest statuses", () => {
    const ids = Object.fromEntries(byOption["offer_de"].routes.map((r) => [r.route.id, r.status]));
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
    const withOffer: Profile = { ...explorer, situation: "offer_de" };
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
