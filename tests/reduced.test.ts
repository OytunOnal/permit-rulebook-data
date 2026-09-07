import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, formatEURPer, informativeFields, routeProvenance, routeStatements } from "../src/engine.js";
import { remainingQuestions } from "../src/questions.js";
import type { Dataset, Profile, RouteResult } from "../src/types.js";

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

/**
 * Fresh Amsterdam graduate, 28, with an offer — the scenario's first persona.
 * s5d: the fact that opens the lower Dutch salary is WHERE the degree comes
 * from, not merely how recent it is (product-critique v0.7, B2), so the
 * persona declares a Dutch institution rather than a country-less "yes".
 */
const graduate = (monthly: number, recent: string): Profile => ({
  destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree",
  nl_recent_grad: recent, top200_grad: "no",
  age_band: "u30", occupation_it: "no",
  salary_eur_month: bandFor("salary_eur_month", monthly),
});

describe("s5c — a reduced threshold is a second path inside the same route", () => {
  it("step 1: a graduate on €3,400/month meets the highly-skilled-migrant card on the lower salary", () => {
    const r = byId(graduate(3400, "yes"))["nl-hsm-under30"];
    expect(r.status).toBe("met");
    // The card must be able to quote the number it was measured against.
    expect(routeProvenance(r.route).map((p) => p.value.quote)).toContain(
      "Highly skilled migrants reduced salary criterion € 3,122.00",
    );
    // One card, not two: the reduced path lives inside the salary criterion.
    expect(dataset.countries.flatMap((c) => c.routes).filter((x) => x.id.startsWith("nl-hsm")).length).toBe(2);
  });

  it("step 2: the same graduate on €2,900/month is within reach, measured to €3,122 per month", () => {
    const r = byId(graduate(2900, "yes"))["nl-hsm-under30"];
    expect(r.status).toBe("near");
    const bandFloor = deriveBands(dataset, "salary_eur_month").find((b) => b.id === bandFor("salary_eur_month", 2900))!.min!;
    expect(r.gap_max).toBeCloseTo(3122 - bandFloor, 2);
    // Never the full criterion's distance, and never a bare number.
    expect(r.gap_max).toBeLessThan(4357 - bandFloor);
    expect(formatEURPer(Math.round(r.gap_max!), dataset.fields.find((f) => f.id === "salary_eur_month")!.period))
      .toMatch(/\/month$/);
  });

  it("step 3: without a qualifying institution the lower-salary path is closed and the card names the fact", () => {
    const r = byId(graduate(3400, "no"))["nl-hsm-under30"];
    expect(r.status).not.toBe("met");
    const salary = r.criteria.find((c) => c.criterion.op === "any" && c.outcome === "fail")!;
    const reduced = (salary.criterion as Extract<typeof salary.criterion, { op: "any" }>).paths.at(-1)!;
    const gate = reduced.criteria.find((c) => c.op === "any")!;
    expect(gate.op === "any" && gate.paths.flatMap((p) => p.criteria).map((c) => "field" in c && c.field))
      .toEqual(["nl_recent_grad", "top200_grad"]);
    // Measured against the full criterion — the path the profile can still reach.
    const bandFloor = deriveBands(dataset, "salary_eur_month").find((b) => b.id === bandFor("salary_eur_month", 3400))!.min!;
    expect(r.gap_max).toBeCloseTo(4357 - bandFloor, 2);
  });

  it("the reduced path never beats the full path: a salary that meets neither meets nothing", () => {
    for (const monthly of [900, 2000, 2900, 3400, 4400, 6000]) {
      const withFact = byId(graduate(monthly, "yes"))["nl-hsm-under30"];
      const withoutFact = byId(graduate(monthly, "no"))["nl-hsm-under30"];
      const rank = { met: 2, near: 1, hold: 0 } as const;
      expect(rank[withFact.status], `€${monthly}`).toBeGreaterThanOrEqual(rank[withoutFact.status]);
      if (withoutFact.status === "met") expect(withFact.status).toBe("met");
    }
  });

  it("the institution fact is asked only while a reduced path can still decide", () => {
    // €3,400: the reduced path would pass, the full one would not — it decides.
    const undecided = graduate(3400, "yes");
    delete undecided.nl_recent_grad;
    delete undecided.top200_grad;
    expect([...informativeFields(dataset, undecided)]).toContain("nl_recent_grad");
    // €6,000 clears the full criterion outright: nothing left for it to change
    // ON THIS ROUTE. Since 2026-09-07 the fact also decides the orientation
    // year for anyone bound for the Netherlands — an offer no longer closes
    // that route — so the interview may still ask it, for that reason and not
    // this one. The claim here is about the salary rule, and it is checked
    // where it lives.
    const settled = { ...undecided, salary_eur_month: bandFor("salary_eur_month", 6000) };
    const salary = byId(settled)["nl-hsm-under30"].criteria.find((c) => c.criterion.op === "any" && c.outcome === "pass");
    expect(salary, "the full salary threshold decides it on its own").toBeDefined();
    expect(byId(settled)["nl-hsm-under30"].unknown_fields).not.toContain("nl_recent_grad");
  });

  it("it is asked at most once across a whole interview", () => {
    const answers: Profile = {
      destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree",
      age_band: "u30", occupation_it: "no", experience: "y2in5",
      experience_7y: "no", nl_recent_grad: "yes", top200_grad: "no",
      salary_eur_month: bandFor("salary_eur_month", 3400),
      salary_eur_year: bandFor("salary_eur_year", 40800),
    };
    const profile: Profile = {};
    const asked: string[] = [];
    for (let i = 0; i < 50; i++) {
      const remaining = remainingQuestions(dataset, profile);
      if (remaining.length === 0) break;
      const q = remaining[0];
      if (answers[q.field] === undefined) throw new Error(`persona has no answer for ${q.field}`);
      asked.push(q.field);
      profile[q.field] = answers[q.field];
    }
    expect(asked.filter((f) => f === "nl_recent_grad").length).toBeLessThanOrEqual(1);
    // The country-less fact does not belong to a Dutch interview at all (s5d).
    expect(asked).not.toContain("qualification_recent");
  });

  it("NL Blue Card: the lower salary needs the degree AND a qualifying institution", () => {
    const base: Profile = {
      destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree",
      nl_recent_grad: "yes", top200_grad: "no", age_band: "a30to35", occupation_it: "no",
      salary_eur_month: bandFor("salary_eur_month", 4900),
    };
    expect(byId(base)["nl-blue-card"].status).toBe("met");
    expect(byId({ ...base, nl_recent_grad: "no" })["nl-blue-card"].status).not.toBe("met");
  });

  it("ES Blue Card: the reduced Spanish threshold is the qualification limb only", () => {
    const base: Profile = {
      destination: "es", citizenship: "TR", situation: "offer", qualification: "degree",
      qualification_recent: "yes", salary_eur_year: bandFor("salary_eur_year", 35000),
    };
    expect(byId(base)["es-blue-card"].status).toBe("met");
    expect(byId({ ...base, qualification_recent: "no" })["es-blue-card"].status).not.toBe("met");
    // The shortage-occupation limb ships as a caveat, not a number — and not
    // as a requirement either: it says the reader may qualify for LESS, which
    // is not something to demand of them (human catch 2026-09-07).
    const route = byId(base)["es-blue-card"].route;
    const caveats = routeStatements(route).filter((s) => s.kind === "caveat");
    expect(caveats.map((s) => s.text).join(" ").toLowerCase()).toMatch(/shortage occupation/);
    expect(routeProvenance(route).map((p) => p.value.quote)).toContain("– Umbral reducido: 33.085,09 €");
  });

  it("NL ICT keeps the standard amounts — no lower one is evidenced for it", () => {
    const route = dataset.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-ict")!;
    const quotes = routeProvenance(route).map((p) => p.value.quote);
    // The claim is about the data, not the prose: no reduced amount is modelled
    // on this route, and its thresholds are the full highly-skilled-migrant ones.
    expect(quotes.some((q) => q.includes("3,122"))).toBe(false);
    const amounts: number[] = [];
    const walk = (cs: Criterion[]): void => {
      for (const c of cs) {
        if (c.op === "any") { for (const p of c.paths) walk(p.criteria); continue; }
        if (c.op === "gte") amounts.push(c.threshold.amount);
      }
    };
    walk(route.criteria);
    expect(amounts.sort((a, b) => a - b)).toEqual([4357, 5942]);
  });
});

describe("s5c — the two French talent routes the dataset had excluded", () => {
  const innovante: Profile = {
    destination: "fr", citizenship: "TR", situation: "offer", qualification: "degree",
    fr_degree: "no", fr_innovative_employer: "yes",
    salary_eur_year: bandFor("salary_eur_year", 40000),
  };
  const mission: Profile = {
    destination: "fr", citizenship: "TR", situation: "ict", qualification: "degree",
    fr_local_contract: "yes", salary_eur_year: bandFor("salary_eur_year", 40000),
  };

  it("step 5: an innovative-company hire at €40,000 meets the route, with both conditions stated", () => {
    const r = byId(innovante)["fr-talent-innovante"];
    expect(r.status).toBe("met");
    expect(r.route.preconditions!.join(" · ")).toMatch(/research and development/i);
    expect(r.route.preconditions!.join(" · ")).toMatch(/ministry of the economy/i);
    expect(routeProvenance(r.route).map((p) => p.value.quote)).toContain(
      "Avoir un contrat de travail qui prévoit une rémunération brute annuelle supérieure ou égale à 39 582 €.",
    );
  });

  it("step 5: \"I don't know\" about the employer leaves the route undecided, never failed, with a learn link", () => {
    const r = byId({ ...innovante, fr_innovative_employer: "unknown" })["fr-talent-innovante"];
    expect(r.status).toBe("hold");
    expect(r.hard_fail).toBe(false);
    expect(r.unknown_fields).toContain("fr_innovative_employer");
    expect(dataset.fields.find((f) => f.id === "fr_innovative_employer")!.learn!.url).toMatch(/^https:\/\//);
  });

  it("step 6: an intra-group mission at €40,000 with a French contract meets the route", () => {
    const r = byId(mission)["fr-talent-mission"];
    expect(r.status).toBe("met");
    const pre = r.route.preconditions!.join(" · ").toLowerCase();
    expect(pre).toMatch(/three months|3 months/);
    expect(pre).toContain("group");
    expect(routeProvenance(r.route).map((p) => p.value.quote)).toContain(
      "Percevoir une rémunération brute annuelle supérieure ou égale à 39 582 €.",
    );
  });

  it("step 6: without a French contract the route holds on that reason, and the ICT card stays available", () => {
    const results = byId({ ...mission, fr_local_contract: "no", salary_eur_month: bandFor("salary_eur_month", 2500) });
    const held = results["fr-talent-mission"];
    expect(held.status).toBe("hold");
    const failed = held.criteria.filter((c) => c.outcome === "fail").map((c) => c.criterion);
    expect(failed.some((c) => "field" in c && c.field === "fr_local_contract")).toBe(true);
    expect(results["fr-ict"].status).toBe("met");
  });

  it("the new routes mirror the existing French citizenship, destination and localization criteria", () => {
    const routes = dataset.countries.find((c) => c.code === "FR")!.routes;
    const shape = (id: string) =>
      JSON.stringify(routes.find((r) => r.id === id)!.criteria.slice(0, 2));
    expect(shape("fr-talent-innovante")).toBe(shape("fr-talent-qualifie"));
    expect(shape("fr-talent-mission")).toBe(shape("fr-ict"));
    for (const id of ["fr-talent-innovante", "fr-talent-mission"]) {
      const localization = routes.find((r) => r.id === id)!.criteria.find((c) => c.op === "any")!;
      expect(localization.op === "any" && localization.label).toBe("located in France");
    }
  });

  it("exclusions.md no longer lists them as excluded", () => {
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");
    expect(text).toMatch(/entreprise innovante.*salarié en mission/s);
    expect(text).toMatch(/s5c/);
  });
});
