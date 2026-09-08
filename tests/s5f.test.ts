import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, forEachCriterion, routeReadings, routeStatements } from "../src/engine.js";
import { quotedWithoutProvenance } from "../src/prose.js";
import { criterionPhrase } from "../src/verdict.js";
import type { Criterion, Dataset, FieldDef, Profile, Route, RouteResult, RouteStatus } from "../src/types.js";

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
  // Destination first: a money answer is an index into the ladder that
  // destination is asked, so drawing one before it would draw from a ladder
  // the profile is not on (F12).
  for (const def of [...ds.fields].sort((a, b) => Number(b.id === "destination") - Number(a.id === "destination")))
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
 * Holding the population fixed and moving only the rules leaves the rule
 * change as the single variable — re-running the seeded generator over the old
 * option list would compare two different populations of people, and a shifted
 * random draw would read as a moved verdict.
 *
 * It has ONE blind spot, and s5f fell into it: a profile that answers the new
 * option scores nothing under this baseline, because the answer is not in its
 * ladder. Comparing those two is a tautology — "the new answer does nothing on
 * a dataset that has never heard of it" — and it is exactly the case that
 * matters. So this baseline is used only for profiles answering options the
 * ladder ALREADY had; what the new answer is worth is measured against its
 * neighbour on the ladder instead, below (review 2026-09-07, H2).
 */
function withoutOption(ds: Dataset, field: string, value: string): Dataset {
  const before = structuredClone(ds) as Dataset;
  const def = before.fields.find((f) => f.id === field)!;
  def.options = (def.options ?? []).filter((o) => o.value !== value);
  for (const o of def.options) if (o.implies) o.implies = o.implies.filter((v) => v !== value);
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

/**
 * Is `now` a worse answer for the person reading it than `than`?
 *
 * Everything a route result says, in the order a reader feels it: the verdict
 * first, then whether the door is shut, then the score, and — only where those
 * agree, because a gap on a route you just passed is not comparable to a gap
 * on one you failed — how far the remaining shortfall is.
 */
function worseFor(now: RouteResult, than: RouteResult): string | null {
  if (TOWARDS_READER[now.status] < TOWARDS_READER[than.status]) return `status ${than.status} → ${now.status}`;
  if (now.hard_fail && !than.hard_fail) return "became a hard fail";
  const scored = (r: RouteResult) => r.points?.scored ?? 0;
  if (scored(now) < scored(than)) return `points ${scored(than)} → ${scored(now)}`;
  if (now.status !== than.status || now.hard_fail !== than.hard_fail) return null;
  const wider = (a?: number, b?: number) => a !== undefined && b !== undefined && a > b;
  if (wider(now.gap_max, than.gap_max)) return `salary gap ${than.gap_max} → ${now.gap_max}`;
  if (wider(now.gap_points, than.gap_points)) return `points gap ${than.gap_points} → ${now.gap_points}`;
  return null;
}

/** The same person, answering the experience question differently. */
const answering = (p: Profile, experience: string): Map<string, RouteResult> =>
  new Map(evaluate(dataset, { ...p, experience }).map((r) => [r.route.id, r]));

describe("s5f — the ICT route reads the three years its own quote states", () => {
  /**
   * `es-ict` shipped `experience eq y5in7` beside a source quoting "una
   * experiencia profesional de al menos 3 años" (Ley 14/2013, art. 73.2.b). A
   * verdict its own quote refutes is the thing the sweep exists to remove, and
   * it cost one token once `y3in7` existed (review 2026-09-07, H1).
   */
  const ICT = "es-ict";

  it("the criterion and the quote say the same number", () => {
    let criterion: Criterion | undefined;
    forEachCriterion(routeOf(ICT).criteria, (c) => {
      if ((c.op === "in" || c.op === "eq") && c.field === "experience") criterion = c;
    });
    expect(criterion, `${ICT} does not read experience`).toBeDefined();
    expect(criterion!.op).toBe("in");
    expect((criterion as Extract<Criterion, { op: "in" }>).values).toEqual([NEW_OPTION, "y5in7"]);
    expect(criterion!.source?.quote).toContain("al menos 3 años");
    expect(criterion!.source?.legal_basis).toBe("Ley 14/2013, art. 73.2.b)");
    expect(criterionPhrase(dataset, criterion!)).toBe("at least three years of related experience");
  });

  it("a three-year transferee is met where the five-year answer was demanded", () => {
    const base: Profile = {
      citizenship: "TR", destination: "es", situation: "ict", situation_country: "es",
      qualification: "vocational", salary_eur_year: bandFor("salary_eur_year", 45000),
    };
    const statusOn = (experience: string): RouteStatus =>
      evaluate(dataset, { ...base, experience }).find((r) => r.route.id === ICT)!.status;
    expect(statusOn(NEW_OPTION)).toBe("met");
    expect(statusOn("y5in7")).toBe("met");
    // Two years is below the article's three, here as on the other Spanish route.
    expect(statusOn("y2in5")).toBe("hold");
  });
});

describe("s5f invariant — adding an option to a band field changes nothing for anyone who could already answer", () => {
  it("holds for every route, over 600 profiles drawn from the answers the ladder already had", { timeout: 120_000 }, () => {
    // The honest reading of decision 1's "every other route keeps its
    // verdicts": nobody who could answer the question before sees a different
    // card because a fourth option now exists. Profiles are drawn from the OLD
    // ladder, so the comparison is between two datasets that both understand
    // every answer in it — no tautology, and no route exempted.
    const before = withoutOption(dataset, "experience", NEW_OPTION);
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(before, rand, rand() < 0.5 ? 1 : 0.75);
      expect(p.experience, "a profile answered with the new option").not.toBe(NEW_OPTION);
      const after = new Map(evaluate(dataset, p).map((r) => [r.route.id, rowOf(r)]));
      for (const r of evaluate(before, p))
        expect(after.get(r.route.id), `${r.route.id} moved on ${JSON.stringify(p)}`).toBe(rowOf(r));
    }
  });
});

describe("s5f — the experience ladder is ordinal: a longer record is never worth less", () => {
  /**
   * The regression this replaced a tautology to catch. `y3in7` shipped with no
   * `implies`, so a person with three recent years who answered honestly FAILED
   * `de-experienced-worker` (which reads `y2in5`, `y5in7`) and scored 0
   * Chancenkarte points where the two-year answer scored 2. The old guard could
   * not see it: it stripped the new option from both sides, so a `y3in7`
   * profile scored nothing in either (review 2026-09-07, H2).
   */
  it("the new answer declares the band it clears, and the ladder stays in order", () => {
    const options = fieldOptions(dataset, "experience");
    expect(options.find((o) => o.value === NEW_OPTION)!.implies).toEqual(["y2in5"]);
    // Only the rungs below it, and never a rung above.
    expect(options.find((o) => o.value === "y5in7")!.implies ?? []).not.toContain(NEW_OPTION);
    expect(options.find((o) => o.value === "y2in5")!.implies).toBeUndefined();
    expect(options.find((o) => o.value === "lt2")!.implies).toBeUndefined();
  });

  it("no route pays the three-year answer less than the two-year one, over 600 profiles", { timeout: 120_000 }, () => {
    // The guard the scenario asked for, stated so it cannot be tautological:
    // the same profile, two answers, every route. If this cannot be made true,
    // the failure names the route — which is the report decision 1 demands.
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const two = answering(p, "y2in5");
      for (const [id, three] of answering(p, NEW_OPTION))
        expect(worseFor(three, two.get(id)!), `${id} pays y3in7 less than y2in5 on ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("nor the five-year answer less than the three-year one", { timeout: 120_000 }, () => {
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const three = answering(p, NEW_OPTION);
      for (const [id, five] of answering(p, "y5in7"))
        expect(worseFor(five, three.get(id)!), `${id} pays y5in7 less than y3in7 on ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("and where three years buys more than two, it is on the routes that ask for three", { timeout: 120_000 }, () => {
    // The other half of "no verdict moved elsewhere": the routes the new answer
    // moves are the two whose own source says three years, and no other.
    const rand = lcg(20260907);
    const movers = new Set<string>();
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const two = answering(p, "y2in5");
      for (const [id, three] of answering(p, NEW_OPTION))
        if (rowOf(three) !== rowOf(two.get(id)!)) movers.add(id);
    }
    expect([...movers].sort()).toEqual(["es-highly-qualified", "es-ict"]);
    for (const id of movers) expect(namesValue(routeOf(id), "experience", NEW_OPTION)).toBe(true);
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

  it("and the three-year answer gets what the two-year answer gets, on both German rules", () => {
    // Germany's rules do not flinch — its criterion and its points table are
    // byte-for-byte what they were. What changed is that the honest three-year
    // answer now reaches them, through the band it clears. Shipped without
    // this, the route FAILED that person and the ladder paid them nothing.
    const met = (experience: string) =>
      evaluate(dataset, de(experience)).find((r) => r.route.id === "de-experienced-worker")!;
    expect(met(NEW_OPTION).status).toBe(met("y2in5").status);
    expect(met(NEW_OPTION).status).toBe("met");

    const ck = (experience: string) => {
      const p = { ...de(experience), qualification: "none", recognition_de: "partial", german: "b1" };
      return evaluate(dataset, p).find((r) => r.route.id === "de-chancenkarte")!.points!.scored;
    };
    expect(ck(NEW_OPTION), "the three-year answer scores nothing").toBe(ck("y2in5"));
    expect(ck("y5in7")).toBeGreaterThan(ck(NEW_OPTION));
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
    // The law names two rungs and the dataset still carries two: the third
    // answer is paid through what it declares it clears, not by writing a row
    // into a table the Anlage does not have.
    expect(points).toEqual({ y2in5: 2, y5in7: 3 });
  });
});

/**
 * Decision 3's count, as counted.
 *
 * The scenario says 38 bare preconditions. The dataset carried 37 at the
 * commit this slice began from, and 40 two commits before that; 38 appears
 * nowhere in the file's history, so 37 is the number and the discrepancy is
 * stated rather than rounded away (review 2026-09-07, H5). Of those 37, 34
 * became sourced statements, 2 became declared readings, and 1 was deleted as
 * repealed law (pre-2023 art. 71.1).
 */
const BARE_PRECONDITIONS_REMOVED = 37;

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
    expect(sourced).toBeGreaterThan(BARE_PRECONDITIONS_REMOVED - 4);
    expect(ours).toBeGreaterThan(0);
  });

  it("nothing a card renders is left unaccounted for", () => {
    expect(quotedWithoutProvenance(dataset)).toEqual([]);
  });
});
