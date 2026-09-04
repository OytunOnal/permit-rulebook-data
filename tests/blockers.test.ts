import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, fieldOptions, matchOptions, notices } from "../src/engine.js";
import { countryVocabulary } from "../src/countries.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * Permanent checks for blockers that were cleared once. Each targets the
 * SYMPTOM a user would feel, not the path that produced it — the EU-passport
 * blocker was cleared in s5b through the citizenship criterion and came back
 * in s5c through the country data, which a path-shaped test could not see.
 */

describe("cleared blocker: a person with EU free movement is never told they need a permit", () => {
  const passports = fieldOptions(dataset, "citizenship");

  it("every passport in the list resolves to exactly one class", () => {
    for (const p of passports) expect(p.implies, p.label).toHaveLength(1);
  });

  it("every EU/EEA/CH passport draws the no-permit notice — whatever route data says", () => {
    const free = passports.filter((p) => p.implies?.[0] === "eu_eea_ch");
    expect(free.length).toBeGreaterThan(25);
    for (const p of free) {
      const matched = notices(dataset, { citizenship: p.value });
      expect(matched.map((n) => n.kind), p.label).toContain("no-permit-needed");
    }
  });

  it("no other passport draws it, so the notice never overstates who is free", () => {
    for (const p of passports.filter((x) => x.implies?.[0] !== "eu_eea_ch"))
      expect(notices(dataset, { citizenship: p.value }).map((n) => n.kind), p.label)
        .not.toContain("no-permit-needed");
  });

  it("an EU/EEA/CH passport never produces a route the user could be told to pursue", () => {
    // The rejection screen this blocker was about listed routes with
    // "Not met: citizenship". Whatever else changes, that list stays empty.
    for (const p of fieldOptions(dataset, "citizenship").filter((x) => x.implies?.[0] === "eu_eea_ch")) {
      const profile: Profile = { destination: "all", citizenship: p.value, situation: "offer" };
      expect(evaluate(dataset, profile).some((r) => r.status !== "hold"), p.label).toBe(false);
    }
  });

  it("the vocabulary lists passport issuers only — a dependent territory would misclassify its residents", () => {
    // Åland was listed and classed third-country; its residents hold Finnish
    // passports, so the tool told EU citizens they needed a permit (s5c
    // review). Re-adding any of these means first sourcing which passport its
    // residents actually hold.
    const territories = ["AX", "GP", "MQ", "RE", "GF", "YT", "GL", "FO", "GI", "JE", "GG", "IM",
      "AW", "CW", "SX", "BQ", "NC", "PF", "WF", "PM", "BL", "MF", "PR", "GU", "VI", "AS", "MP",
      "AQ", "BV", "HM", "UM", "TF"];
    const listed = countryVocabulary.countries.map((c) => c.code);
    for (const t of territories) expect(listed, t).not.toContain(t);
  });
});

describe("cleared blocker: a card never claims more than the interview checked", () => {
  it("every route states the conditions the authority applies but we never ask", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        expect(route.preconditions?.length, `${route.id} has no preconditions line`).toBeGreaterThan(0);
  });
});

describe("cleared blocker: a person can find their own country", () => {
  const passports = fieldOptions(dataset, "citizenship");

  it("every country is reachable by typing its own name", () => {
    for (const p of passports)
      expect(matchOptions(passports, p.label).map((o) => o.value), p.label).toContain(p.value);
  });

  it("the names people actually type reach the country they mean", () => {
    // "turkey" returned "No country matches — check the spelling", and the
    // list shows 60 of 198 with no way to page: the user could not answer the
    // question that decides whether they need a permit (product-critique
    // 2026-09-04). One row per name a person is likely to type.
    const expected: Array<[string, string]> = [
      ["turkey", "TR"], ["türkiye", "TR"], ["holland", "NL"], ["czech republic", "CZ"],
      ["ivory coast", "CI"], ["burma", "MM"], ["swaziland", "SZ"], ["macedonia", "MK"],
      ["cape verde", "CV"], ["east timor", "TL"], ["usa", "US"], ["uae", "AE"],
      ["great britain", "GB"], ["drc", "CD"], ["kosovo", "XK"], ["hong kong", "HK"],
    ];
    for (const [typed, code] of expected)
      expect(matchOptions(passports, typed).map((o) => o.value), typed).toContain(code);
  });

  it("an alias is a search key, never a label", () => {
    for (const p of passports) expect(p.label).not.toMatch(/^(Turkey|Holland|Czech Republic|Burma|Swaziland)$/);
  });

  it("a needle that matches nothing returns nothing, rather than everything", () => {
    expect(matchOptions(passports, "zzzz")).toEqual([]);
    expect(matchOptions(passports, "   ")).toHaveLength(passports.length);
  });
});
