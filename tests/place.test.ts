import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unlocks } from "../src/engine.js";
import { declaredPlace, optionMeans, unlockMeansOf, unlockProfile, unlockTitleOf } from "../src/verdict.js";
import { countryPhrase } from "../src/countries.js";
import type { Dataset, Profile, Unlock } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * The human's phone walk, 2026-09-08. A reader still deciding where to go was
 * offered "With a job offer in your offer, transfer or agreement in Germany",
 * and under it a sentence about "an employer there itself".
 *
 * One row, two places, neither of them right: the heading had taken the
 * situation_country option's `short` — which is a subject ("your offer,
 * transfer or agreement in Germany"), written to follow "Needs" — and read it
 * as a place name, while the sentence under it had resolved the place against
 * the reader's answers alone, where nothing said Germany.
 *
 * A leverage row is a counterfactual: it is the reader's profile with this step
 * taken. Every phrase in the row reads off that one profile, so the place is
 * resolved once and the heading carries a place, never a subject.
 */

const EXPLORER: Profile = {
  destination: "all", citizenship: "third_country", situation: "none",
  qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
  experience: "y2in5", german: "b1", funds_eur_month: "band_1",
  nl_recent_grad: "no", top200_grad: "no",
};

const GERMAN: Profile = {
  destination: "de", citizenship: "third_country", situation: "none",
  qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
  experience: "y2in5", german: "b1", funds_eur_month: "band_1", salary_eur_year: "band_4",
};

const row = (p: Profile, option: string, qualifier?: string): Unlock =>
  unlocks(dataset, p).find((u) =>
    u.option.value === option && (u.qualifier?.option.value ?? undefined) === qualifier)!;

/** Every field's subject text — the phrase written to follow "Needs". */
const subjects = dataset.fields.map((f) => f.subject).filter((s): s is string => !!s);

describe("a leverage row names its place once", () => {
  it("destination Germany, no offer yet: heading and sentence both say Germany", () => {
    const u = row(GERMAN, "offer");
    expect(u.qualifier).toBeUndefined();
    expect(unlockTitleOf(dataset, u, GERMAN)).toBe("a job offer");
    expect(unlockMeansOf(dataset, u, GERMAN)).toContain("an employer in Germany itself");
  });

  it("still deciding: the fork's own country is the place, in the heading and the sentence", () => {
    const u = row(EXPLORER, "offer", "de");
    expect(unlockTitleOf(dataset, u, EXPLORER)).toBe("a job offer in Germany");
    expect(unlockMeansOf(dataset, u, EXPLORER)).toContain("an employer in Germany itself");
    // The place is the country, never the field's subject text.
    expect(unlockTitleOf(dataset, u, EXPLORER)).not.toContain("your offer, transfer or agreement");
  });

  it("still deciding: every offer row is forked, each on its own country", () => {
    // The step only opens routes somewhere, so the engine offers it per country
    // rather than once with no place. Each fork says which.
    const offers = unlocks(dataset, EXPLORER).filter((u) => u.option.value === "offer");
    expect(offers.length).toBeGreaterThan(0);
    for (const u of offers) {
      expect(u.qualifier?.field).toBe("situation_country");
      const place = countryPhrase(u.qualifier!.option.value.toUpperCase())!;
      expect(unlockTitleOf(dataset, u, EXPLORER)).toBe(`a job offer in ${place}`);
      expect(unlockMeansOf(dataset, u, EXPLORER)).toContain(`an employer in ${place} itself`);
    }
  });

  it("nowhere declared at all: the sentence keeps the fallback rather than inventing a place", () => {
    const nowhere: Profile = { destination: "all", situation: "none" };
    expect(declaredPlace(dataset, nowhere)).toBe("");
    const offer = dataset.fields.find((f) => f.id === "situation")!.options!
      .find((o) => o.value === "offer")!;
    expect(optionMeans(offer, dataset, nowhere)).toContain("an employer there itself");
  });

  it("an offer already placed: that country wins over the destination, and carries its article", () => {
    const placed: Profile = { ...EXPLORER, situation: "offer", situation_country: "nl" };
    expect(declaredPlace(dataset, placed)).toBe("the Netherlands");
    const u = row(placed, "ict") ?? row(placed, "research");
    if (u) expect(unlockTitleOf(dataset, u, placed)).not.toContain("your offer, transfer or agreement");
  });

  it("the place resolves the same way for every row of every profile", () => {
    for (const profile of [EXPLORER, GERMAN, { ...EXPLORER, situation_country: "nl", situation: "offer" }])
      for (const u of unlocks(dataset, profile)) {
        const title = unlockTitleOf(dataset, u, profile);
        const means = unlockMeansOf(dataset, u, profile);
        for (const s of subjects) expect(title, title).not.toContain(s);
        expect(means).not.toContain("{place}");
        expect(means).not.toContain("in there");
        expect(title.endsWith(" in")).toBe(false);
        // Whatever place the heading names, the sentence names the same one.
        const place = declaredPlace(dataset, unlockProfile(u, profile));
        if (place && means) expect(means, title).toContain(`in ${place}`);
        if (place && u.qualifier) expect(title).toContain(` in ${place}`);
      }
  });
});
