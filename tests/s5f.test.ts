import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, forEachCriterion, referencedFields, routeReadings, routeStatements } from "../src/engine.js";
import { quotedWithoutProvenance } from "../src/prose.js";
import { criterionPhrase } from "../src/verdict.js";
import type { Criterion, Dataset, FieldDef, Profile, Route, RouteResult, RouteStatus } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * The option decision 1 added, and the route that reads it.
 *
 * s5f added "3+ years within the last 7" to a single four-rung experience
 * question, with an `implies` saying it also cleared the two-year band. s25
 * retired that implication as false — three years inside seven can lie
 * entirely six-to-seven years ago — and split the question in two: the last
 * five years (under 2 · 2+) and the last seven (under 3 · 3 to under 5 · 5+).
 * Decision 1's substance stands: Spain's three-year rules read a three-year
 * answer, on the seven-year question now.
 */
const NEW_OPTION = "3to5";
const SEVEN = "experience_7y";
const FIVE = "experience_5y";
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

/** Does any criterion of this route read the field at all? */
function readsField(route: Route, field: string): boolean {
  let found = false;
  forEachCriterion(route.criteria, (c) => { if (referencedFields(c).includes(field)) found = true; });
  return found;
}

/** One row of the verdict pin: everything a person reads as an outcome. */
const rowOf = (r: { route: Route; status: RouteStatus; hard_fail: boolean; gap_max?: number; gap_points?: number; points?: { scored: number } }): string =>
  [r.route.id, r.status, r.hard_fail ? 1 : 0, r.gap_max ?? "", r.gap_points ?? "", r.points ? r.points.scored : ""].join("|");

const TOWARDS_READER: Record<RouteStatus, number> = { hold: 0, near: 1, met: 2 };

describe("s5f decision 1 — the three-year Spanish criterion", () => {
  it("the interview offers a three-year answer, in the ladder and in plain English", () => {
    const options = fieldOptions(dataset, SEVEN);
    const added = options.find((o) => o.value === NEW_OPTION);
    expect(added, `${SEVEN} has no three-year option`).toBeDefined();
    expect(added!.label).toBe("3 to under 5 years");
    expect(added!.short).toBe("3 to under 5 years of related experience in the last seven");
    // Between the under-three band and the five-year one: a ladder a reader
    // climbs must not put a bigger number below a smaller one.
    expect(options.map((o) => o.value)).toEqual(["lt3", NEW_OPTION, "5plus"]);
  });

  it("the route reads it, and says what the law says", () => {
    let phrase: string | undefined;
    forEachCriterion(routeOf(READS_IT).criteria, (c) => {
      if (c.op === "in" && c.field === SEVEN) phrase = criterionPhrase(dataset, c);
    });
    expect(phrase, `${READS_IT} does not read ${SEVEN} with an in-criterion`).toBeDefined();
    expect(phrase).toBe("at least three years of related experience");
  });

  it("the criterion carries article 71.2 in the authority's own words", () => {
    let quote: string | undefined;
    let basis: string | undefined;
    forEachCriterion(routeOf(READS_IT).criteria, (c) => {
      if (c.op === "in" && c.field === SEVEN) {
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

  it("step 1: three years and everything else met resolves met; under three resolves not yet", () => {
    // A Spaniard-bound professional with no degree, whose only route to the
    // qualification limb is the experience one.
    const base: Profile = {
      citizenship: "TR", destination: "es", situation: "offer", qualification: "vocational",
      salary_eur_year: bandFor("salary_eur_year", 45000),
    };
    const statusOn = (seven: string): RouteStatus =>
      evaluate(dataset, { ...base, [SEVEN]: seven }).find((r) => r.route.id === READS_IT)!.status;

    expect(statusOn(NEW_OPTION)).toBe("met");
    // Under three is below the article's three, and stays below it.
    expect(statusOn("lt3")).toBe("hold");
    expect(statusOn("5plus")).toBe("met");
    // The five-year question is not this route's business: the article
    // names no window, and the seven-year answer is read as a floor (s25).
    expect(readsField(routeOf(READS_IT), FIVE)).toBe(false);
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

/** The same person, answering one experience question differently. */
const answering = (p: Profile, field: string, value: string): Map<string, RouteResult> =>
  new Map(evaluate(dataset, { ...p, [field]: value }).map((r) => [r.route.id, r]));

describe("s5f — the ICT route reads the three years its own quote states", () => {
  /**
   * `es-ict` shipped `experience eq y5in7` beside a source quoting "una
   * experiencia profesional de al menos 3 años" (Ley 14/2013, art. 73.2.b). A
   * verdict its own quote refutes is the thing the sweep exists to remove, and
   * it cost one token once a three-year answer existed (review 2026-09-07, H1).
   */
  const ICT = "es-ict";

  it("the criterion and the quote say the same number", () => {
    let criterion: Criterion | undefined;
    forEachCriterion(routeOf(ICT).criteria, (c) => {
      if ((c.op === "in" || c.op === "eq") && c.field === SEVEN) criterion = c;
    });
    expect(criterion, `${ICT} does not read ${SEVEN}`).toBeDefined();
    expect(criterion!.op).toBe("in");
    expect((criterion as Extract<Criterion, { op: "in" }>).values).toEqual([NEW_OPTION, "5plus"]);
    expect(criterion!.source?.quote).toContain("al menos 3 años");
    expect(criterion!.source?.legal_basis).toBe("Ley 14/2013, art. 73.2.b)");
    expect(criterionPhrase(dataset, criterion!)).toBe("at least three years of related experience");
  });

  it("a three-year transferee is met where the five-year answer was demanded", () => {
    const base: Profile = {
      citizenship: "TR", destination: "es", situation: "ict", situation_country: "es",
      qualification: "vocational", salary_eur_year: bandFor("salary_eur_year", 45000),
    };
    const statusOn = (seven: string): RouteStatus =>
      evaluate(dataset, { ...base, [SEVEN]: seven }).find((r) => r.route.id === ICT)!.status;
    expect(statusOn(NEW_OPTION)).toBe("met");
    expect(statusOn("5plus")).toBe("met");
    // Under three is below the article's three, here as on the other Spanish route.
    expect(statusOn("lt3")).toBe("hold");
  });
});

describe("s5f — each experience question is ordinal: a longer record is never worth less", () => {
  /**
   * The regression this replaced a tautology to catch. `y3in7` shipped with no
   * `implies`, so a person with three recent years who answered honestly FAILED
   * `de-experienced-worker` and scored 0 Chancenkarte points where the
   * two-year answer scored 2 (review 2026-09-07, H2). The fix was an `implies`
   * from the three-year rung to the two-year one — and that was the wrong
   * fix: the two rungs were windows of different lengths, and the longer
   * window does not contain the shorter (v1.1 critique F2, s25). The property
   * that was always meant is this one: within ONE window, a higher rung is
   * never worth less, with the other window held fixed.
   */
  it("neither question's options imply another — the ladder is honest by its rungs, not by a declared clearance", () => {
    for (const field of [FIVE, SEVEN])
      for (const o of fieldOptions(dataset, field)) expect(o.implies, `${field}:${o.value}`).toBeUndefined();
  });

  it("no route pays three-to-five in the last seven less than under three, over 600 profiles", { timeout: 120_000 }, () => {
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const under = answering(p, SEVEN, "lt3");
      for (const [id, three] of answering(p, SEVEN, NEW_OPTION))
        expect(worseFor(three, under.get(id)!), `${id} pays ${NEW_OPTION} less than lt3 on ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("nor five-plus less than three-to-five", { timeout: 120_000 }, () => {
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const three = answering(p, SEVEN, NEW_OPTION);
      for (const [id, five] of answering(p, SEVEN, "5plus"))
        expect(worseFor(five, three.get(id)!), `${id} pays 5plus less than ${NEW_OPTION} on ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("nor two-plus in the last five less than under two", { timeout: 120_000 }, () => {
    const rand = lcg(20260907);
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const under = answering(p, FIVE, "lt2");
      for (const [id, two] of answering(p, FIVE, "2plus"))
        expect(worseFor(two, under.get(id)!), `${id} pays 2plus less than lt2 on ${JSON.stringify(p)}`).toBeNull();
    }
  });

  it("and where a rung buys more, it is on a route that reads that question", { timeout: 120_000 }, () => {
    // The other half of "no verdict moved elsewhere": a seven-year rung moves
    // only routes that read the seven-year question, and a five-year rung only
    // routes that read the five-year one.
    const rand = lcg(20260907);
    const movers: Record<string, Set<string>> = { [FIVE]: new Set(), [SEVEN]: new Set() };
    for (let i = 0; i < 600; i++) {
      const p = randomProfile(dataset, rand, rand() < 0.5 ? 1 : 0.75);
      const under = answering(p, SEVEN, "lt3");
      for (const [id, three] of answering(p, SEVEN, NEW_OPTION))
        if (rowOf(three) !== rowOf(under.get(id)!)) movers[SEVEN]!.add(id);
      const lt2 = answering(p, FIVE, "lt2");
      for (const [id, two] of answering(p, FIVE, "2plus"))
        if (rowOf(two) !== rowOf(lt2.get(id)!)) movers[FIVE]!.add(id);
    }
    expect([...movers[SEVEN]!].sort()).toEqual(["es-highly-qualified", "es-ict", "nl-blue-card"]);
    expect([...movers[FIVE]!].sort()).toEqual(["de-chancenkarte", "de-experienced-worker"]);
    for (const field of [FIVE, SEVEN])
      for (const id of movers[field]!) expect(readsField(routeOf(id), field), `${id} moved on ${field}`).toBe(true);
  });
});

describe("s5f step 2 — Germany reads the five-year window its sentence names", () => {
  const de = (five: string, seven: string): Profile => ({
    citizenship: "TR", destination: "de", situation: "offer", qualification: "vocational",
    occupation_it: "no", [FIVE]: five, [SEVEN]: seven, salary_eur_year: bandFor("salary_eur_year", 50000),
  });

  it("the experienced-worker route reads two years within five, and nothing about the last seven", () => {
    let value: string | undefined;
    forEachCriterion(routeOf("de-experienced-worker").criteria, (c) => {
      if (c.op === "eq" && c.field === FIVE) value = c.value;
    });
    expect(value).toBe("2plus");
    expect(readsField(routeOf("de-experienced-worker"), SEVEN)).toBe(false);
  });

  it("its verdict turns on the five-year answer alone, whatever the seven-year one", () => {
    for (const seven of ["lt3", NEW_OPTION, "5plus"]) {
      const worker = (five: string) => evaluate(dataset, de(five, seven)).find((r) => r.route.id === "de-experienced-worker")!.status;
      expect(worker("2plus"), seven).toBe("met");
      expect(worker("lt2"), seven).toBe("hold");
    }
  });

  it("the Opportunity Card pays the higher of Nr. 7 and Nr. 6, never both", () => {
    // § 20b Abs. 1 Nr. 7: two years in the last five, 2 points, "und keine
    // Punkte nach Nummer 6"; Nr. 6: five years in the last seven, 3 points.
    const ck = (five: string, seven: string) => {
      const p = { ...de(five, seven), qualification: "none", recognition_de: "partial", german: "b1" };
      return evaluate(dataset, p).find((r) => r.route.id === "de-chancenkarte")!.points!.scored;
    };
    expect(ck("2plus", NEW_OPTION) - ck("lt2", NEW_OPTION)).toBe(2);
    expect(ck("2plus", "5plus") - ck("lt2", NEW_OPTION)).toBe(3);
    expect(ck("lt2", "5plus")).toBe(ck("2plus", "5plus"));
  });

  it("the Chancenkarte points ladder carries the two rungs the Anlage names, on the two questions", () => {
    let rows: unknown;
    forEachCriterion(routeOf("de-chancenkarte").criteria, (c) => {
      if (c.op === "points")
        for (const item of c.table.items) if ("rows" in item) rows = item.rows;
    });
    // The law names two rungs and the dataset carries two — one item, so the
    // reader is paid the higher and never the sum.
    expect(rows).toEqual([
      { field: FIVE, value: "2plus", points: 2 },
      { field: SEVEN, value: "5plus", points: 3 },
    ]);
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
