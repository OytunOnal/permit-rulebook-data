import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, forEachCriterion, referencedFields, routeProvenance, routeReadings, routeStatements } from "../src/engine.js";
import type { Criterion, Dataset, Profile, Route, RouteResult } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** The band a euro figure falls in — band ids shift whenever a threshold is
 * added, and a test that names a number should not have to know that. */
function bandFor(field: string, amount: number): string {
  return deriveBands(dataset, field).find(
    (b) => (b.min === undefined || amount >= b.min) && (b.max === undefined || amount < b.max),
  )!.id;
}

const byId = (profile: Profile): Record<string, RouteResult> =>
  Object.fromEntries(evaluate(dataset, profile).map((r) => [r.route.id, r]));

const routeOf = (id: string): Route =>
  dataset.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

/** Every field id any criterion of a route reads, at any depth. */
function fieldsOf(route: Route): string[] {
  const out = new Set<string>();
  forEachCriterion(route.criteria, (c) => { for (const f of referencedFields(c)) out.add(f); });
  return [...out];
}

/**
 * The scenario's engineer: 27, third-country passport, an offer in the
 * Netherlands at €3,500/month, graduated two years ago. Only where he
 * graduated changes between the two runs.
 */
const engineer = (grad: { nl_recent_grad: string; top200_grad: string }): Profile => ({
  destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree",
  age_band: "u30", occupation_it: "no",
  salary_eur_month: bandFor("salary_eur_month", 3500),
  ...grad,
});

const NL_REDUCED_ROUTES = ["nl-hsm-30plus", "nl-hsm-under30", "nl-blue-card"];

describe("s5d — the Dutch reduced salary criterion asks where you studied", () => {
  it("step 2: a foreign, non-designated graduate on €3,500 is measured against €4,357, not €3,122", () => {
    const r = byId(engineer({ nl_recent_grad: "no", top200_grad: "no" }))["nl-hsm-under30"];
    expect(r.status).toBe("near");
    // The distance is to the full criterion — the reduced path is unreachable
    // for him, so it must never be the yardstick.
    expect(r.gap_max).toBeCloseTo(4357 - 3122, 2);
  });

  it("step 2: the same engineer with a Dutch degree meets the route on €3,500", () => {
    const r = byId(engineer({ nl_recent_grad: "yes", top200_grad: "no" }))["nl-hsm-under30"];
    expect(r.status).toBe("met");
  });

  it("step 2: an IND-designated foreign institution opens the same path", () => {
    const r = byId(engineer({ nl_recent_grad: "no", top200_grad: "yes" }))["nl-hsm-under30"];
    expect(r.status).toBe("met");
  });

  it("\"I don't know\" about the designated list leaves the route undecided, never failed", () => {
    const r = byId(engineer({ nl_recent_grad: "no", top200_grad: "unknown" }))["nl-hsm-under30"];
    expect(r.status).toBe("hold");
    expect(r.hard_fail).toBe(false);
    expect(r.unknown_fields).toContain("top200_grad");
    // The find-out link the unknown earns already exists on the field.
    expect(dataset.fields.find((f) => f.id === "top200_grad")!.learn!.url).toMatch(/^https:\/\//);
  });

  it("the country-less recent-qualification fact no longer governs any Dutch route", () => {
    for (const id of NL_REDUCED_ROUTES)
      expect(fieldsOf(routeOf(id)), id).not.toContain("qualification_recent");
  });

  it("each Dutch reduced path is a disjunction over the two facts that name an institution", () => {
    for (const id of NL_REDUCED_ROUTES) {
      const fields = fieldsOf(routeOf(id));
      expect(fields, id).toContain("nl_recent_grad");
      expect(fields, id).toContain("top200_grad");
    }
  });

  it("the two facts are asked with a country in the question, and the loose one is not", () => {
    const label = (id: string) => dataset.fields.find((f) => f.id === id)!.label;
    expect(label("nl_recent_grad").toLowerCase()).toContain("dutch");
    // The IND-designation question names the authority whose list it is.
    expect(label("top200_grad").toLowerCase()).toMatch(/immigration|ind\b/);
    // The fact this slice removed from the Dutch routes asks no country at all —
    // which is why it may not govern them.
    expect(label("qualification_recent").toLowerCase()).not.toMatch(/dutch|netherlands/);
  });

  it("step 2: every Dutch reduced route states the limbs of its own rule that it does not check", () => {
    // Stated as a caveat since 2026-09-07, not as a precondition: a sentence
    // that says the reader may qualify for LESS is not something to demand of
    // them. The two highly-skilled-migrant routes carry the orientation-year
    // limbs; the Blue Card carries the limbs its OWN source states, which say
    // nothing about an orientation year.
    const caveats = (id: string) =>
      routeStatements(routeOf(id)).filter((s) => s.kind === "caveat").map((s) => s.text).join(" · ").toLowerCase();
    for (const id of ["nl-hsm-30plus", "nl-hsm-under30"]) expect(caveats(id), id).toContain("orientation year");
    expect(caveats("nl-blue-card")).toMatch(/extend|change employer/);
    for (const id of NL_REDUCED_ROUTES)
      expect(routeOf(id).preconditions!.join(" · ").toLowerCase(), id).not.toContain("orientation year");
  });

  it("the exclusion is recorded with its reason and its date", () => {
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");
    expect(text.toLowerCase()).toContain("orientation year");
    expect(text).toMatch(/2026-09-07/);
    // The reason is the one that makes it honest: the interview never asks
    // about permits the person already holds or has held.
    expect(text.toLowerCase()).toMatch(/permit.*(already|held)|(already|held).*permit/);
  });
});

describe("s5d — Spain is not swept along with the Dutch change", () => {
  it("es-blue-card keeps the qualification-within-3-years fact", () => {
    const fields = fieldsOf(routeOf("es-blue-card"));
    expect(fields).toContain("qualification_recent");
    expect(fields).not.toContain("nl_recent_grad");
    expect(fields).not.toContain("top200_grad");
  });

  it("its unverified institution scope is recorded, not guessed at — and the reader is told", () => {
    // It was recorded in a criterion `note`, which reached no screen and
    // declared no kind; the reader was never told. It is a reading now: our
    // own words, on the card, under a heading that says they are ours
    // (review 2026-09-07).
    const readings = routeReadings(routeOf("es-blue-card")).map((r) => r.text).join(" ");
    expect(readings).toMatch(/did not settle|no such limit/i);
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");
    expect(text).toMatch(/es-blue-card/);
  });

  it("a Spanish graduate's verdict is untouched by the Dutch change", () => {
    const base: Profile = {
      destination: "es", citizenship: "TR", situation: "offer", qualification: "degree",
      qualification_recent: "yes", salary_eur_year: bandFor("salary_eur_year", 35000),
    };
    expect(byId(base)["es-blue-card"].status).toBe("met");
    expect(byId({ ...base, qualification_recent: "no" })["es-blue-card"].status).not.toBe("met");
  });
});

describe("s5d — the values the routes quote are the ones they quoted before", () => {
  it("the three Dutch routes still rest on exactly their published amounts and read dates", () => {
    const shape = (id: string) =>
      routeProvenance(routeOf(id))
        .filter((p) => p.amount !== undefined) // a caveat's quote is not an amount
        .map((p) => `${p.amount} ${p.value.quote} ${p.value.retrieved_at}`)
        .sort();
    expect(shape("nl-hsm-under30")).toEqual([
      "3122 Highly skilled migrants reduced salary criterion € 3,122.00 2026-09-04",
      "4357 Highly skilled migrants younger than 30 years € 4,357.00 2026-09-04",
    ]);
    expect(shape("nl-hsm-30plus")).toEqual([
      "3122 Highly skilled migrants reduced salary criterion € 3,122.00 2026-09-04",
      "5942 Highly skilled migrants 30 years or older € 5,942.00 2026-09-04",
    ]);
    expect(shape("nl-blue-card")).toEqual([
      "4754 Reduced salary criterion European Blue Card € 4,754.00 2026-09-04",
      "5942 European Blue Card € 5,942.00 2026-09-04",
    ]);
  });
});
