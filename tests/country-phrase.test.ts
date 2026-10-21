import { describe, expect, it } from "vitest";
import { countryPhrase, countryPhraseAtStart, countryPossessive, countryVocabulary } from "../src/index.js";
import type { CountryVocabulary } from "../src/index.js";

/**
 * A country's name in running text (#152; #151, ruling 6): one phrase from the
 * country list, in the shape the sentence needs, so no screen keeps its own
 * article set or possessive.
 */

const WRITTEN: CountryVocabulary = {
  classes: { everyone: { label: "Everyone", short: "any passport" } },
  countries: [
    { code: "XA", name: "Testing Islands", article: "the" },
    { code: "XB", name: "Plainland" },
  ],
};

describe("the country phrase within a sentence", () => {
  it("carries the article the list gives the name, and nothing the list does not", () => {
    expect(countryPhrase("NL")).toBe("the Netherlands");
    expect(countryPhrase("DE")).toBe("Germany");
    expect(countryPhrase("XA", WRITTEN)).toBe("the Testing Islands");
    expect(countryPhrase("XB", WRITTEN)).toBe("Plainland");
  });

  it("throws on a code the list does not hold, rather than handing a caller nothing", () => {
    expect(() => countryPhrase("ZZ")).toThrow(/ZZ/);
    expect(() => countryPhrase("DE", WRITTEN)).toThrow(/DE/);
  });
});

describe("the country phrase at a sentence or heading start", () => {
  it("opens with a capital, the article's too", () => {
    expect(countryPhraseAtStart("NL")).toBe("The Netherlands");
    expect(countryPhraseAtStart("DE")).toBe("Germany");
    expect(countryPhraseAtStart("XA", WRITTEN)).toBe("The Testing Islands");
    expect(countryPhraseAtStart("XB", WRITTEN)).toBe("Plainland");
  });

  it("opens with a capital for every country on the list", () => {
    for (const { code } of countryVocabulary.countries)
      expect(countryPhraseAtStart(code), code).toMatch(/^\p{Lu}/u);
  });

  it("throws on a code the list does not hold", () => {
    expect(() => countryPhraseAtStart("ZZ")).toThrow(/ZZ/);
  });
});

describe("the country phrase as a possessive", () => {
  it("keeps the article and takes the apostrophe a name ending in s takes", () => {
    expect(countryPossessive("NL")).toBe("the Netherlands'");
    expect(countryPossessive("DE")).toBe("Germany's");
    expect(countryPossessive("XA", WRITTEN)).toBe("the Testing Islands'");
    expect(countryPossessive("XB", WRITTEN)).toBe("Plainland's");
  });

  it("throws on a code the list does not hold", () => {
    expect(() => countryPossessive("ZZ")).toThrow(/ZZ/);
  });
});
