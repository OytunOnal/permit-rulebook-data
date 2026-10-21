import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  phraseOf, phraseAtStartOf, possessiveOf, possessiveAtStartOf, countryVocabulary, evaluate,
  reasonFor,
} from "../src/index.js";
import type { CountryVocabulary, Dataset, Profile } from "../src/index.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

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
    expect(phraseOf("NL")).toBe("the Netherlands");
    expect(phraseOf("DE")).toBe("Germany");
    expect(phraseOf("XA", WRITTEN)).toBe("the Testing Islands");
    expect(phraseOf("XB", WRITTEN)).toBe("Plainland");
  });

  it("throws on a code the list does not hold, rather than handing a caller nothing", () => {
    expect(() => phraseOf("ZZ")).toThrow(/ZZ/);
    expect(() => phraseOf("DE", WRITTEN)).toThrow(/DE/);
  });
});

describe("the country phrase at a sentence or heading start", () => {
  it("opens with a capital, the article's too", () => {
    expect(phraseAtStartOf("NL")).toBe("The Netherlands");
    expect(phraseAtStartOf("DE")).toBe("Germany");
    expect(phraseAtStartOf("XA", WRITTEN)).toBe("The Testing Islands");
    expect(phraseAtStartOf("XB", WRITTEN)).toBe("Plainland");
  });

  it("opens with a capital for every country on the list", () => {
    for (const { code } of countryVocabulary.countries)
      expect(phraseAtStartOf(code), code).toMatch(/^\p{Lu}/u);
  });

  it("throws on a code the list does not hold", () => {
    expect(() => phraseAtStartOf("ZZ")).toThrow(/ZZ/);
  });
});

describe("a verdict line that names a route's country", () => {
  it("names it with its article, wherever the name falls", () => {
    const toGermany: Profile = { destination: "de" };
    const dutch = evaluate(dataset, toGermany).filter((r) => r.country === "NL");
    const said = dutch.flatMap((r) => {
      const reason = reasonFor(dataset, r, toGermany);
      return [reason.line, ...reason.rows.filter((row) => row.kind === "where").map((row) => row.text)];
    }).filter((text) => text.includes("Netherlands"));
    expect(said.length).toBeGreaterThan(0);
    for (const text of said) expect(text).not.toMatch(/(?<!the )Netherlands/);
  });
});

describe("the country phrase as a possessive", () => {
  it("keeps the article and takes the apostrophe a name ending in s takes", () => {
    expect(possessiveOf("NL")).toBe("the Netherlands'");
    expect(possessiveOf("DE")).toBe("Germany's");
    expect(possessiveOf("XA", WRITTEN)).toBe("the Testing Islands'");
    expect(possessiveOf("XB", WRITTEN)).toBe("Plainland's");
  });

  it("throws on a code the list does not hold", () => {
    expect(() => possessiveOf("ZZ")).toThrow(/ZZ/);
  });

  it("opens with a capital where it opens a sentence or a heading", () => {
    expect(possessiveAtStartOf("NL")).toBe("The Netherlands'");
    expect(possessiveAtStartOf("DE")).toBe("Germany's");
    expect(possessiveAtStartOf("XA", WRITTEN)).toBe("The Testing Islands'");
    expect(possessiveAtStartOf("XB", WRITTEN)).toBe("Plainland's");
    expect(() => possessiveAtStartOf("ZZ")).toThrow(/ZZ/);
  });
});
