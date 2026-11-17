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
  it("passes the check, having read at least one pair of each kind", () => {
    // The check's subject: one sentence quoted twice on a route, and a shorter
    // quote inside a longer one. Without one of each it proves nothing.
    const pairs = sentencePairsOf(dataset);
    expect(pairs.filter((p) => p.kind === "same").length).toBeGreaterThan(0);
    expect(pairs.filter((p) => p.kind === "contained").length).toBeGreaterThan(0);
    expect(validateDataset(dataset).errors.filter((e) => e.keyword === "oneReadingPerSentence")).toEqual([]);
  });
});
