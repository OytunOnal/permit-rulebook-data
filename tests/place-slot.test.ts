import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countryPhrase, optionMeans } from "../src/index.js";
import type { Dataset, FieldOption, Profile } from "../src/index.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * A phrase built for a place is never handed "there" (#154; #151, ruling 7).
 * On the all-four path the reader had chosen no country, and the option read
 * "an employer there itself". The filler gives "in" and the country's phrase
 * when a place is declared, and "in the country you move to" when none is.
 */

const NO_PLACE = "in the country you move to";

/** Every option in the dataset whose meaning carries a place slot. */
const slotPhrases = dataset.fields.flatMap((f) => f.options ?? [])
  .filter((o): o is FieldOption & { means: string } => !!o.means?.includes("{place}"));

/** The destinations a reader can declare as one country, as country codes. */
const declaredCodes = dataset.fields.find((f) => f.id === "destination")!.options!
  .map((o) => o.value).filter((v) => v !== "all").map((v) => v.toUpperCase());

/** Profiles in which no place is declared: nothing answered, or all four. */
const PLACELESS: Profile[] = [{}, { destination: "all" }, { destination: "all", situation: "offer" }];

const WRITTEN: FieldOption = { value: "x", label: "x", means: "Work {place}, and then {place} again." };

describe("the place filler", () => {
  it("fills a declared place with 'in' and the country's in-sentence phrase", () => {
    expect(optionMeans(WRITTEN, dataset, { destination: "nl" }))
      .toBe("Work in the Netherlands, and then in the Netherlands again.");
    expect(optionMeans(WRITTEN, dataset, { destination: "all", situation_country: "de" }))
      .toBe("Work in Germany, and then in Germany again.");
  });

  it("fills no declared place with 'in the country you move to', never 'there'", () => {
    for (const profile of PLACELESS)
      expect(optionMeans(WRITTEN, dataset, profile), JSON.stringify(profile))
        .toBe(`Work ${NO_PLACE}, and then ${NO_PLACE} again.`);
  });
});

describe("each slot phrase in the dataset", () => {
  it("is found on the situation question's offer and transfer options", () => {
    expect(slotPhrases.map((o) => o.value).sort()).toEqual(["ict", "offer"]);
  });

  it("names the declared country with its phrase, and never 'there'", () => {
    expect(declaredCodes.length).toBeGreaterThan(0);
    for (const option of slotPhrases)
      for (const code of declaredCodes) {
        const filled = optionMeans(option, dataset, { destination: code.toLowerCase() });
        expect(filled, `${option.value} ${code}`).toContain(`in ${countryPhrase(code)}`);
        expect(filled, `${option.value} ${code}`).not.toMatch(/\bthere\b/i);
      }
  });

  it("says 'in the country you move to' where no place is declared, and never 'there'", () => {
    for (const option of slotPhrases)
      for (const profile of PLACELESS) {
        const filled = optionMeans(option, dataset, profile);
        expect(filled, option.value).toContain(NO_PLACE);
        expect(filled, option.value).not.toMatch(/\bthere\b/i);
      }
  });

  it("reads as ruling 7 words the two situation phrases, with a place and without", () => {
    const situation = dataset.fields.find((f) => f.id === "situation")!.options!;
    const offer = situation.find((o) => o.value === "offer")!;
    const ict = situation.find((o) => o.value === "ict")!;
    expect(optionMeans(offer, dataset, { destination: "de" })).toBe(
      "An employment contract directly with an employer in Germany — including one you already hold — not a transfer to a branch on a contract you hold abroad.");
    expect(optionMeans(offer, dataset, { destination: "all" })).toBe(
      "An employment contract directly with an employer in the country you move to — including one you already hold — not a transfer to a branch on a contract you hold abroad.");
    expect(optionMeans(ict, dataset, { destination: "nl" })).toBe(
      "Your contract stays with the company abroad and it moves you to its branch in the Netherlands.");
    expect(optionMeans(ict, dataset, {})).toBe(
      "Your contract stays with the company abroad and it moves you to its branch in the country you move to.");
  });
});
