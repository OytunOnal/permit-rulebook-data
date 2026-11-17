import { describe, expect, it } from "vitest";
import { sentencePairsOf } from "../src/one-reading.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset } from "../src/types.js";
import { readJson } from "./read-json.js";

const dataset = readJson<Dataset>("../data/dataset.json");

/**
 * The shipped dataset reads each sentence of a page once per route
 * (OytunOnal/permit-rulebook#421), counted over the pairs the check read, so
 * a check that read nothing cannot pass it.
 */
describe("the shipped dataset reads each sentence of a page once per route", () => {
  it("passes the check, having read each sentence quoted twice on a route", () => {
    // Measured by the site's .run/362/dupes.mjs over live values: 9 sentences
    // quoted twice on one route (de-chancenkarte, es-researcher,
    // fr-talent-blue-card, fr-talent-innovante twice, fr-talent-mission,
    // fr-talent-qualifie, nl-blue-card, nl-ict), and 5 shorter quotes inside
    // longer ones (de-ict-card, de-researcher, fr-ict's sentence quoted with
    // and without its full stop, fr-talent-qualifie's salary sentence over its
    // criterion's and its statement's first words).
    const pairs = sentencePairsOf(dataset);
    expect(pairs.filter((p) => p.kind === "same").map((p) => p.route).sort()).toEqual([
      "de-chancenkarte", "es-researcher", "fr-talent-blue-card", "fr-talent-innovante", "fr-talent-innovante", "fr-talent-mission",
      "fr-talent-qualifie", "nl-blue-card", "nl-ict",
    ]);
    expect(pairs.filter((p) => p.kind === "contained").map((p) => p.route).sort()).toEqual([
      "de-ict-card", "de-researcher", "fr-ict", "fr-talent-qualifie", "fr-talent-qualifie",
    ]);
    expect(validateDataset(dataset).errors.filter((e) => e.keyword === "oneReadingPerSentence")).toEqual([]);
  });
});
