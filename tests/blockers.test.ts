import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, fieldOptions, matchOptions, notices, routeStatements } from "../src/engine.js";
import { countryVocabulary } from "../src/countries.js";
import type { Dataset, Profile, Route } from "../src/types.js";

/** Everything a card lists under "Also required — not checked here": the plain
 * lines and the ones that carry a quote. */
const preconditionsOf = (route: Route): string[] =>
  [...(route.preconditions ?? []), ...routeStatements(route).filter((s) => s.kind === "precondition").map((s) => s.text)];

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
  // Demanding a line from every route invited a false one: the Chancenkarte
  // carried "Part-time work limited to 20 hours/week", which is what the card
  // PERMITS, not something the applicant must satisfy — and it read as a
  // requirement under "Also required" (human catch 2026-09-04). A route with
  // no unasked condition we can source says so here, deliberately.
  const NO_UNASKED_CONDITIONS = ["de-chancenkarte"];

  it("every route states the conditions the authority applies but we never ask", () => {
    for (const country of dataset.countries)
      for (const route of country.routes) {
        if (NO_UNASKED_CONDITIONS.includes(route.id)) {
          expect(route.preconditions, `${route.id} is listed as having none`).toBeUndefined();
          continue;
        }
        expect(route.preconditions?.length, `${route.id} has no preconditions line`).toBeGreaterThan(0);
      }
  });

  it("a precondition states something the applicant must satisfy, never what the permit allows", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        for (const p of preconditionsOf(route))
          expect(p, `${route.id}: "${p}"`).not.toMatch(/permitted|allowed|you may work|hours per week|hours\/week|renewable|valid for/i);
  });

  // A condition statement is a precondition that carries its quote, so it is
  // held to the precondition rule above AND to the provenance rule every other
  // value obeys. The orientation year shipped its unasked condition as an
  // invented criterion instead — "you have no offer yet" — which failed people
  // the source does not fail (2026-09-07).
  it("every statement a route makes carries the source and the date behind it", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        for (const s of routeStatements(route)) {
          expect(s.text.length, `${route.id}:${s.id}`).toBeGreaterThan(4);
          // Every statement, without exception: our own words about what we
          // did or did not model are not statements at all any more, they are
          // `route.readings`, so there is no kind to check for here
          // (review 2026-09-07).
          if (s.source) {
            expect(s.source.source_url, `${route.id}:${s.id}`).toMatch(/^https:\/\//);
            expect(s.source.quote.length, `${route.id}:${s.id}`).toBeGreaterThan(4);
            expect(s.source.retrieved_at, `${route.id}:${s.id}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          } else {
            // The one alternative to a quote is an attributable decision not to
            // have one. Silence would read as if the promise held (isolated
            // critique #5), and prose would let anyone silence this by writing
            // something (review 2026-09-07) — so the reason is from a fixed set
            // and the date is held to the shape the sourced side is held to.
            const why = s.unsourced;
            expect(why, `${route.id}:${s.id} has neither a source nor a reason`).toBeDefined();
            expect(REASONS, `${route.id}:${s.id}`).toContain(why!.reason);
            expect(why!.checked_at, `${route.id}:${s.id}`).toMatch(DATED);
          }
        }
  });
});

/** The reasons a statement may have no quote, and the shape its check-date
 * takes — both the schema's, so a test cannot drift from the gate. */
const REASONS = ["scanned-image", "not-published-in-words", "unreachable"];
const DATED = /^\d{4}-\d{2}-\d{2}$/;

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

  it("the country whose name IS what was typed comes first", () => {
    // A person typing "niger" and pressing Enter was recorded as Nigerian —
    // the first row was Niger, and the first row is what Enter takes
    // (product-critique v0.7, B1). Ordering is half the fix; the other half
    // is the control committing what is highlighted.
    const first = (typed: string) => matchOptions(passports, typed)[0].value;
    expect(first("niger")).toBe("NE");
    expect(first("Niger")).toBe("NE");
    expect(first("sudan")).toBe("SD");
    expect(first("india")).toBe("IN");
    expect(first("china")).toBe("CN");
    // Aliases count as names: the name a person grew up with is still theirs.
    expect(first("turkey")).toBe("TR");
    expect(first("holland")).toBe("NL");
  });

  it("every country is the first row for its own exact name", () => {
    for (const p of passports)
      expect(matchOptions(passports, p.label)[0].value, p.label).toBe(p.value);
  });

  it("a partial needle still puts the shortest way in first, alphabetically after", () => {
    // No exact match: the ordering must stay the stable, alphabetical one, so
    // the highlighted row does not move under the user between keystrokes.
    const values = matchOptions(passports, "united").map((o) => o.label);
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b, "en")));
  });

  it("a needle that matches nothing returns nothing, rather than everything", () => {
    expect(matchOptions(passports, "zzzz")).toEqual([]);
    expect(matchOptions(passports, "   ")).toHaveLength(passports.length);
  });
});
