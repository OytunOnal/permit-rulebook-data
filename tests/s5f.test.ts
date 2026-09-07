import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, forEachCriterion, routeReadings, routeStatements } from "../src/engine.js";
import { quotedWithoutProvenance } from "../src/prose.js";
import { criterionPhrase } from "../src/verdict.js";
import type { Criterion, Dataset, FieldDef, Profile, Route, RouteStatus } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** The option decision 1 adds, and the route that reads it. */
const NEW_OPTION = "y3in7";
const READS_IT = "es-highly-qualified";

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function optionValues(ds: Dataset, def: FieldDef): string[] {
  return def.type === "money_band"
    ? deriveBands(ds, def.id).map((b) => b.id)
    : fieldOptions(ds, def.id).map((o) => o.value);
}

function randomProfile(ds: Dataset, rand: () => number, answerProb: number): Profile {
  const p: Profile = {};
  for (const def of ds.fields)
    if (rand() < answerProb) {
      const vals = optionValues(ds, def);
      p[def.id] = vals[Math.floor(rand() * vals.length)];
    }
  return p;
}

/** The band a euro figure falls in — band ids move when a threshold does. */
function bandFor(field: string, amount: number): string {
  return deriveBands(dataset, field).find(
    (b) => (b.min === undefined || amount >= b.min) && (b.max === undefined || amount < b.max),
  )!.id;
}

const routeOf = (id: string): Route =>
  dataset.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

/** Does any criterion of this route name the value at all? */
function namesValue(route: Route, field: string, value: string): boolean {
  let found = false;
  forEachCriterion(route.criteria, (c) => {
    if (c.op === "eq" && c.field === field && c.value === value) found = true;
    if (c.op === "in" && c.field === field && c.values.includes(value)) found = true;
    if (c.op === "points" && c.table.items.some((i) => i.field === field && value in i.points)) found = true;
  });
  return found;
}

/**
 * The dataset as it stood BEFORE an option joined a band field: the option
 * gone from the ladder, and gone from every criterion that names it.
 *
 * This is the only honest baseline for "did anything else move". Re-running
 * the seeded generator over the old option list would compare two different
 * populations of people, and a shifted random draw would read as a moved
 * verdict; holding the population fixed and moving only the rules leaves the
 * rule change as the single variable.
 */
function withoutOption(ds: Dataset, field: string, value: string): Dataset {
  const before = structuredClone(ds) as Dataset;
  const def = before.fields.find((f) => f.id === field)!;
  def.options = (def.options ?? []).filter((o) => o.value !== value);
  const strip = (c: Criterion): void => {
    if (c.op === "in" && c.field === field) c.values = c.values.filter((v) => v !== value);
    if (c.op === "points")
      for (const item of c.table.items)
        if (item.field === field) delete item.points[value];
  };
  for (const country of before.countries)
    for (const route of country.routes) forEachCriterion(route.criteria, strip);
  return before;
}

/** One row of the verdict pin: everything a person reads as an outcome. */
const rowOf = (r: { route: Route; status: RouteStatus; hard_fail: boolean; gap_max?: number; gap_points?: number; points?: { scored: number } }): string =>
  [r.route.id, r.status, r.hard_fail ? 1 : 0, r.gap_max ?? "", r.gap_points ?? "", r.points ? r.points.scored : ""].join("|");

const TOWARDS_READER: Record<RouteStatus, number> = { hold: 0, near: 1, met: 2 };

describe("s5f decision 1 — the three-year Spanish criterion", () => {
  it("the interview offers a three-year answer, in the ladder and in plain English", () => {
    const options = fieldOptions(dataset, "experience");
    const added = options.find((o) => o.value === NEW_OPTION);
    expect(added, "experience has no three-year option").toBeDefined();
    expect(added!.label).toBe("3+ years within the last 7");
    expect(added!.short).toBe("3+ years of related experience");
    // Between the two-year band and the five-year one: a ladder a reader
    // climbs must not put a bigger number below a smaller one.
    expect(options.map((o) => o.value)).toEqual(["lt2", "y2in5", NEW_OPTION, "y5in7"]);
  });

  it("the route reads it, and says what the law says", () => {
    let phrase: string | undefined;
    forEachCriterion(routeOf(READS_IT).criteria, (c) => {
      if (c.op === "in" && c.field === "experience") phrase = criterionPhrase(dataset, c);
    });
    expect(phrase, `${READS_IT} does not read experience with an in-criterion`).toBeDefined();
    expect(phrase).toBe("at least three years of related experience");
  });

  it("the criterion carries article 71.2 in the authority's own words", () => {
    let quote: string | undefined;
    let basis: string | undefined;
    forEachCriterion(routeOf(READS_IT).criteria, (c) => {
      if (c.op === "in" && c.field === "experience") {
        quote = c.source?.quote;
        basis = c.source?.legal_basis;
      }
    });
    expect(quote).toContain("experiencia profesional de al menos tres años");
    expect(basis).toBe("Ley 14/2013, art. 71.2");
  });

  it("the reading that apologised for the five-year answer is gone — it is no longer true", () => {
    expect(routeReadings(routeOf(READS_IT)).map((r) => r.id))
      .not.toContain("experience-answer-is-conservative");
  });

  it("step 1: three years and everything else met resolves met; two years resolves as it did", () => {
    // A Spaniard-bound professional with no degree, whose only route to the
    // qualification limb is the experience one.
    const base: Profile = {
      citizenship: "TR", destination: "es", situation: "offer", qualification: "vocational",
      salary_eur_year: bandFor("salary_eur_year", 45000),
    };
    const statusOn = (experience: string, ds: Dataset = dataset): RouteStatus =>
      evaluate(ds, { ...base, experience }).find((r) => r.route.id === READS_IT)!.status;

    expect(statusOn(NEW_OPTION)).toBe("met");
    // The two-year answer is below the article's three, and stays below it.
    expect(statusOn("y2in5")).toBe("hold");
    expect(statusOn("y2in5")).toBe(statusOn("y2in5", withoutOption(dataset, "experience", NEW_OPTION)));
    expect(statusOn("y5in7")).toBe("met");
  });
});

describe("s5f invariant — adding an option to a band field never changes a verdict on a route that does not read it", () => {
  it("holds for every route but the one, over 600 generated profiles", { timeout: 120_000 }, () => {
    const before = withoutOption(dataset, "experience", NEW_OPTION);
    const reading = dataset.countries.flatMap((c) => c.routes)
      .filter((r) => namesValue(r, "experience", NEW_OPTION)).map((r) => r.id);
    expect(reading).toEqual([READS_IT]);

    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      // Profiles are drawn from the NEW ladder, so the added answer is really
      // in the population — a property that never exercises the new option
      // would prove nothing.
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const after = new Map(evaluate(dataset, p).map((r) => [r.route.id, rowOf(r)]));
      for (const r of evaluate(before, p)) {
        if (reading.includes(r.route.id)) continue;
        expect(after.get(r.route.id), `${r.route.id} moved on ${JSON.stringify(p)}`).toBe(rowOf(r));
      }
    }
  });

  it("and the movement on the one route is always toward the reader", { timeout: 120_000 }, () => {
    const before = withoutOption(dataset, "experience", NEW_OPTION);
    const rand = lcg(20260907);
    let moved = 0;
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const was = evaluate(before, p).find((r) => r.route.id === READS_IT)!;
      const now = evaluate(dataset, p).find((r) => r.route.id === READS_IT)!;
      if (rowOf(was) === rowOf(now)) continue;
      moved++;
      expect(TOWARDS_READER[now.status], `${READS_IT} moved backwards on ${JSON.stringify(p)}`)
        .toBeGreaterThanOrEqual(TOWARDS_READER[was.status]);
      expect(p.experience).toBe(NEW_OPTION);
    }
    expect(moved, "the new option moved nothing at all").toBeGreaterThan(0);
  });
});

describe("s5f step 2 — Germany does not flinch", () => {
  const de = (experience: string): Profile => ({
    citizenship: "TR", destination: "de", situation: "offer", qualification: "vocational",
    occupation_it: "no", experience, salary_eur_year: bandFor("salary_eur_year", 50000),
  });

  it("the experienced-worker route reads two years within five, unchanged", () => {
    let values: string[] | undefined;
    forEachCriterion(routeOf("de-experienced-worker").criteria, (c) => {
      if (c.op === "in" && c.field === "experience") values = c.values;
    });
    expect(values).toEqual(["y2in5", "y5in7"]);
  });

  it("its verdicts are the same on every answer the ladder already had", () => {
    const before = withoutOption(dataset, "experience", NEW_OPTION);
    for (const experience of ["lt2", "y2in5", "y5in7"]) {
      const p = de(experience);
      const now = evaluate(dataset, p).find((r) => r.route.id === "de-experienced-worker")!;
      const was = evaluate(before, p).find((r) => r.route.id === "de-experienced-worker")!;
      expect(rowOf(now), experience).toBe(rowOf(was));
    }
    expect(evaluate(dataset, de("y2in5")).find((r) => r.route.id === "de-experienced-worker")!.status).toBe("met");
  });

  it("the 7-year IT limb and the Chancenkarte points ladder are untouched", () => {
    const before = withoutOption(dataset, "experience", NEW_OPTION);
    const it = { ...de("y5in7"), qualification: "none", occupation_it: "yes" };
    for (const p of [it, { ...it, experience: "y2in5" }]) {
      const now = evaluate(dataset, p).find((r) => r.route.id === "de-experienced-worker")!;
      expect(rowOf(now)).toBe(rowOf(evaluate(before, p).find((r) => r.route.id === "de-experienced-worker")!));
    }
    let points: Record<string, number> | undefined;
    forEachCriterion(routeOf("de-chancenkarte").criteria, (c) => {
      if (c.op === "points")
        for (const item of c.table.items) if (item.field === "experience") points = item.points;
    });
    expect(points).toEqual({ y2in5: 2, y5in7: 3 });
  });
});

describe("s5f invariant — no precondition reaches the screen without a declared kind", () => {
  const allRoutes = (): Route[] => dataset.countries.flatMap((c) => c.routes);

  it("the bare slot is kinded now: a precondition with no source fails the build", () => {
    // The mutation s5e used on every other slot, applied to the one it left
    // out. A sentence about what an authority requires is the authority's
    // position; putting it in a bare string array was how 37 of them shipped
    // with no quote, no date, and nothing watching them.
    const mutated = structuredClone(dataset) as Dataset;
    mutated.countries[0].routes[0].preconditions = ["The professional licence must already be in hand"];
    const offences = quotedWithoutProvenance(mutated);
    expect(offences.map((o) => o.path)).toContain(`/countries/${mutated.countries[0].code}/routes/${mutated.countries[0].routes[0].id}/preconditions/0`);
    expect(offences.find((o) => o.path.includes("/preconditions/"))!.reason).toBe("no-source");
  });

  it("and the shipped dataset leaves nothing in it", () => {
    for (const route of allRoutes())
      expect(route.preconditions, `${route.id} still carries a bare precondition`).toBeUndefined();
  });

  it("every precondition a card renders is quoted, or declared ours", () => {
    let sourced = 0;
    let ours = 0;
    for (const route of allRoutes()) {
      for (const s of routeStatements(route)) {
        if (s.kind !== "precondition") continue;
        // Exactly one of the two, which is the rule s5e wrote for statements
        // and this slice extends to the ones that used to be bare.
        expect(Boolean(s.source) !== Boolean(s.unsourced), `${route.id}:${s.id}`).toBe(true);
        sourced++;
      }
      ours += routeReadings(route).length;
    }
    expect(sourced).toBeGreaterThan(0);
    expect(ours).toBeGreaterThan(0);
  });

  it("nothing a card renders is left unaccounted for", () => {
    expect(quotedWithoutProvenance(dataset)).toEqual([]);
  });
});
