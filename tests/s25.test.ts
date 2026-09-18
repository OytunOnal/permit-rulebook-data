import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import {
  contradictionsIn, datasetMeta, deriveBands, evaluate, fieldOptions, forEachCriterion, informativeFields, itemFields,
  referencedFields, routeReadings, unlocks,
} from "../src/engine.js";
import { deriveQuestions } from "../src/questions.js";
import { validateDataset } from "../src/validate.js";
import type { Criterion, Dataset, PointsRow, Profile, ProvenancedText, Route, RouteResult } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const routes = (): Route[] => ds.countries.flatMap((c) => c.routes);
const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

const FIVE = "experience_5y";
const SEVEN = "experience_7y";

/** The band a euro figure falls in — band ids move when a threshold does. */
function bandFor(field: string, amount: number): string {
  return deriveBands(ds, field).find(
    (b) => (b.min === undefined || amount >= b.min) && (b.max === undefined || amount < b.max),
  )!.id;
}

/** Every criterion of a route that reads the field, in dataset order. */
function reading(route: Route, field: string): Criterion[] {
  const found: Criterion[] = [];
  forEachCriterion(route.criteria, (c) => {
    if (c.op === "points") { if (c.table.items.some((i) => itemFields(i).includes(field))) found.push(c); return; }
    if (c.op !== "any" && c.field === field) found.push(c);
  });
  return found;
}

const resultOf = (profile: Profile, id: string): RouteResult =>
  evaluate(ds, profile).find((r) => r.route.id === id)!;

/**
 * s25 — the experience ladder is two questions (v1.1 critique F2).
 *
 * One question with four rungs and a false implication (`y3in7 ⇒ y2in5`:
 * three years inside the last seven can lie entirely six-to-seven years ago)
 * told a three-year answerer that § 6 BeschV was met and paid them the
 * Opportunity Card's two points for a five-year window they may not clear.
 * Two facts, two questions: how much related experience in the last five
 * years, and how much in the last seven. Every rule reads the rung its own
 * sentence names, and no option implies another.
 */
describe("s25 — two questions replace the four-rung ladder", () => {
  it("asks the five-year window and the seven-year window, in that order, where the old question sat", () => {
    const ids = ds.fields.map((f) => f.id);
    expect(ids).not.toContain("experience");
    expect(ids.indexOf(FIVE)).toBe(ids.indexOf("recognition_de") + 1);
    expect(ids.indexOf(SEVEN)).toBe(ids.indexOf(FIVE) + 1);
    // The interview offers both, in the order the dataset declares them.
    const asked = deriveQuestions(ds).map((q) => q.field);
    expect(asked.indexOf(SEVEN)).toBe(asked.indexOf(FIVE) + 1);
  });

  it("the five-year question: under 2 · 2 or more, improvable, in the reader's words", () => {
    const def = ds.fields.find((f) => f.id === FIVE)!;
    expect(def.label).toBe("Related skilled work experience in the last five years?");
    expect(def.short_label).toBe("Experience (last 5 years)");
    expect(def.subject).toBe("your related experience in the last five years");
    expect(def.kind).toBe("improvable");
    expect(fieldOptions(ds, FIVE).map((o) => [o.value, o.label, o.short])).toEqual([
      ["lt2", "Under 2 years", "under 2 years of related experience in the last five"],
      ["2plus", "2 years or more", "2+ years of related experience in the last five"],
    ]);
  });

  it("the seven-year question: under 3 · 3 to under 5 · 5 or more, improvable, the yes/no gone", () => {
    const def = ds.fields.find((f) => f.id === SEVEN)!;
    expect(def.label).toBe("And in the last seven years?");
    expect(def.short_label).toBe("Experience (last 7 years)");
    expect(def.subject).toBe("your related experience in the last seven years");
    expect(def.kind).toBe("improvable");
    expect(fieldOptions(ds, SEVEN).map((o) => [o.value, o.label, o.short])).toEqual([
      ["lt3", "Under 3 years", "under 3 years of related experience in the last seven"],
      ["3to5", "3 to under 5 years", "3 to under 5 years of related experience in the last seven"],
      ["5plus", "5 years or more", "5+ years of related experience in the last seven"],
    ]);
  });

  it("no option of either field implies another — the implication was the bug", () => {
    for (const field of [FIVE, SEVEN])
      for (const o of fieldOptions(ds, field))
        expect(o.implies, `${field}:${o.value} implies ${JSON.stringify(o.implies)}`).toBeUndefined();
  });

  it("no rule anywhere reads the retired field, and every answer a rule names is one the field offers", () => {
    const offered = new Map(ds.fields.map((f) => [f.id, new Set(fieldOptions(ds, f.id).map((o) => o.value))]));
    const check = (route: string, field: string, values: string[]) => {
      expect(field, route).not.toBe("experience");
      if (field !== FIVE && field !== SEVEN) return;
      for (const v of values) expect(offered.get(field)!.has(v), `${route}: ${field} = ${v}`).toBe(true);
    };
    for (const route of routes())
      forEachCriterion(route.criteria, (c) => {
        if (c.op === "eq") check(route.id, c.field, [c.value]);
        else if (c.op === "in" || c.op === "not-in") check(route.id, c.field, c.values);
        else if (c.op === "points")
          for (const item of c.table.items)
            if ("rows" in item) for (const r of item.rows) check(route.id, r.field, [r.value]);
            else check(route.id, item.field, Object.keys(item.points));
      });
  });
});

/**
 * The table the scenario was written from, read 2026-09-17 — one case per
 * row: the rule reads the field and the values its own sentence names.
 */
describe("s25 — every rule reads the rung it names", () => {
  const eq = (c: Criterion) => c as Extract<Criterion, { op: "eq" }>;
  const inn = (c: Criterion) => c as Extract<Criterion, { op: "in" }>;

  it("§ 6 BeschV (DE experienced worker): 2 in the last 5", () => {
    const [c, ...rest] = reading(routeOf("de-experienced-worker"), FIVE);
    expect(rest).toEqual([]);
    expect(c!.op).toBe("eq");
    expect(eq(c!).value).toBe("2plus");
    expect(c!.source?.quote).toContain("Innerhalb der letzten fünf Jahren muss eine mindestens zweijährige");
    expect(c!.source?.retrieved_at).toBe("2026-09-02");
    expect(reading(routeOf("de-experienced-worker"), SEVEN)).toEqual([]);
  });

  it("§ 20b Abs. 1 Nr. 7 and Nr. 6 (DE Opportunity Card): one item, two rows, the best of them", () => {
    const [c, ...rest] = reading(routeOf("de-chancenkarte"), FIVE);
    expect(rest).toEqual([]);
    expect(c!.op).toBe("points");
    const table = (c as Extract<Criterion, { op: "points" }>).table;
    const item = table.items.find((i) => itemFields(i).includes(FIVE))!;
    expect("rows" in item, "the experience item keys on one field").toBe(true);
    expect((item as { rows: PointsRow[] }).rows).toEqual([
      { field: FIVE, value: "2plus", points: 2 },
      { field: SEVEN, value: "5plus", points: 3 },
    ]);
    // The seven-year rung lives in the same item, not in a second one that
    // would be summed: Nr. 7 pays "und keine Punkte nach Nummer 6".
    expect(table.items.filter((i) => itemFields(i).includes(SEVEN))).toEqual([item]);
    expect(table.quote).toBe("Die Mindestpunktzahl beträgt sechs Punkte.");
    expect(table.retrieved_at).toBe("2026-09-02");
  });

  it("Ley 14/2013 art. 71.2 and 73.2.b (ES highly qualified, ICT): at least 3, read as 3 in the last 7", () => {
    for (const id of ["es-highly-qualified", "es-ict"]) {
      const [c, ...rest] = reading(routeOf(id), SEVEN);
      expect(rest, id).toEqual([]);
      expect(c!.op, id).toBe("in");
      expect(inn(c!).values, id).toEqual(["3to5", "5plus"]);
      expect(c!.source?.quote, id).toMatch(/al menos (tres|3) años/);
      expect(c!.source?.retrieved_at, id).toBe("2026-09-07");
      expect(reading(routeOf(id), FIVE), id).toEqual([]);
    }
  });

  it("Ley 14/2013 art. 71.2 a), IND, F16922 (the three Blue Cards): 5 years, read as 5 in the last 7", () => {
    for (const id of ["es-blue-card", "nl-blue-card", "fr-talent-blue-card"]) {
      const five = reading(routeOf(id), SEVEN).filter((c) => c.op === "eq");
      expect(five.length, id).toBe(1);
      expect(eq(five[0]!).value, id).toBe("5plus");
      expect(reading(routeOf(id), FIVE), id).toEqual([]);
    }
    const es = reading(routeOf("es-blue-card"), SEVEN)[0]!.source!;
    expect(es.quote).toContain("un mínimo de cinco años");
    // The sentence lives in art. 71.2 a); 71 bis.1 a) only refers back to it.
    // The citation said 71 bis.2 until 2026-09-17 and the correction is a
    // history line, not a silent edit.
    expect(es.legal_basis).toBe("Ley 14/2013, art. 71.2 a)");
    const corrected = es.history!.find((h) => h.reason === "citation-corrected")!;
    expect(corrected.checked_at).toBe("2026-09-17");
    expect(corrected.quote).toBe(es.quote);
    expect(reading(routeOf("nl-blue-card"), SEVEN).find((c) => c.op === "eq")!.source?.quote)
      .toBe("you have a minimum of 5 years of relevant work experience");
  });

  it("IND (NL Blue Card, IT): 3 in the last 7", () => {
    const it3 = reading(routeOf("nl-blue-card"), SEVEN).filter((c) => c.op === "in");
    expect(it3.length).toBe(1);
    expect(inn(it3[0]!).values).toEqual(["3to5", "5plus"]);
    expect(it3[0]!.source?.quote).toContain("during the period of 7 years before the application");
  });

  it("no window in Spain's or France's five-year sentence, and the card says the seven-year answer is a floor", () => {
    // Read against the BOE snapshot (art. 71.2 a) and b), 73.2 b)) and the
    // F16922 fiche: "al menos tres años", "un mínimo de cinco años", "5 années
    // d'expérience professionnelle" name no window. The reduced IT/listed-
    // profession routes do ("tres años comprendidos en los siete años
    // anteriores", "3 ans acquis au cours des 7 années précédant") and are not
    // modelled. So the seven-year answer is a lower bound the reader can give
    // honestly, and each route says so in its own words.
    for (const id of ["es-highly-qualified", "es-ict", "es-blue-card", "fr-talent-blue-card"]) {
      const floor = routeReadings(routeOf(id)).find((r) => r.id === "seven-year-answer-is-a-floor");
      expect(floor, id).toBeDefined();
      // It opens with OUR reading; what the law requires is the criterion's
      // quote, one line above, and is not restated in our own slot.
      expect(floor!.text, id).toMatch(/^Our question asks about the last seven years; .* names no window/);
      // Named to the reader and never asked: the scope says so in ids and words.
      expect(routeOf(id).scope.not_asked, id).toContain("seven-year-answer-is-a-floor");
      expect(routeOf(id).scope.reason, id).toMatch(/last seven years/);
    }
  });

  it("every re-keyed rule keeps its quote and date and carries a history line saying why", () => {
    const lines: NonNullable<ProvenancedText["history"]> = [];
    for (const id of ["de-experienced-worker", "es-highly-qualified", "es-ict", "es-blue-card", "fr-talent-blue-card", "nl-blue-card"])
      for (const c of [...reading(routeOf(id), FIVE), ...reading(routeOf(id), SEVEN)]) {
        // The rule's own quote, or — for the French rule — the quote on the
        // disjunction above it; the disjunction's source is read either way,
        // since a citation corrected there is a line of this slice too.
        const above = routeOf(id).criteria.flatMap((x) => (x.op === "any" && x.paths.some((p) => p.criteria.includes(c)) ? [x.source] : []))[0];
        const source = c.source ?? above;
        expect(source, `${id} reads experience with no source`).toBeDefined();
        expect(source!.history?.length, `${id}: no history line`).toBeGreaterThan(0);
        lines.push(...source!.history!);
        if (c.source && above?.history) lines.push(...above.history);
      }
    const ck = reading(routeOf("de-chancenkarte"), FIVE)[0] as Extract<Criterion, { op: "points" }>;
    expect(ck.table.history?.length, "the points table: no history line").toBeGreaterThan(0);
    lines.push(...ck.table.history!);
    // One re-key line per rule, written today, and the two lines on the
    // Spanish Blue Card's qualification limbs whose citation was corrected
    // the same day. The reason is the decision; the note is not read here.
    expect(lines.filter((l) => l.reason === "rule-rekeyed").length).toBe(8);
    expect(lines.filter((l) => l.reason === "citation-corrected").length).toBe(2);
    for (const line of lines) expect(line.checked_at).toBe("2026-09-17");
  });
});

describe("s25 — the critique's profile and its neighbours", () => {
  const de = (five: string, seven: string): Profile => ({
    citizenship: "TR", destination: "de", situation: "offer", qualification: "vocational",
    occupation_it: "no", [FIVE]: five, [SEVEN]: seven, salary_eur_year: bandFor("salary_eur_year", 50000),
  });
  const ck = (five: string, seven: string) =>
    resultOf({ ...de(five, seven), qualification: "none", recognition_de: "partial", german: "b1" }, "de-chancenkarte").points!;
  const experiencePoints = (five: string, seven: string) =>
    ck(five, seven).items.filter((i) => i.field === FIVE || i.field === SEVEN);

  it("3 in the last 7 but not 2 in the last 5: Experienced worker not yet, 0 experience points", () => {
    expect(resultOf(de("lt2", "3to5"), "de-experienced-worker").status).toBe("hold");
    expect(experiencePoints("lt2", "3to5")).toEqual([]);
  });

  it("2 in the last 5: met, and 2 points", () => {
    expect(resultOf(de("2plus", "3to5"), "de-experienced-worker").status).toBe("met");
    expect(experiencePoints("2plus", "3to5")).toEqual([{ field: FIVE, points: 2 }]);
  });

  it("5 in the last 7: 3 points, not 5", () => {
    expect(experiencePoints("2plus", "5plus")).toEqual([{ field: SEVEN, points: 3 }]);
    expect(ck("2plus", "5plus").scored - ck("2plus", "3to5").scored).toBe(1);
    // And five in the last seven with under two in the last five is a
    // possible life — the Nr. 6 rung pays it on its own.
    expect(experiencePoints("lt2", "5plus")).toEqual([{ field: SEVEN, points: 3 }]);
  });

  it("the step from the critique's profile is the five-year answer, and it opens Experienced worker", () => {
    const steps = unlocks(ds, de("lt2", "3to5")).filter((u) => u.field === FIVE);
    expect(steps.map((u) => [u.option.value, u.routes.map((r) => [r.route.id, r.status])]))
      .toEqual([["2plus", [["de-experienced-worker", "met"]]]]);
  });

  it("no pairing of the two answers is impossible, so the screen names none", () => {
    // The scenario declared 2+ in the last five against under 3 in the last
    // seven a contradiction; it is not — two and a half years, all inside the
    // last five, answers both honestly (build 2026-09-17, corrected by the
    // coordinator). With these rungs no pair is impossible: five years in the
    // last seven with under two in the last five is a possible life too.
    for (const five of ["lt2", "2plus"])
      for (const seven of ["lt3", "3to5", "5plus"])
        expect(contradictionsIn(ds, { [FIVE]: five, [SEVEN]: seven }), `${five}/${seven}`).toEqual([]);
    for (const pair of ds.contradictions ?? [])
      for (const side of pair.when) expect([FIVE, SEVEN], pair.id).not.toContain(side.field);
  });
});

/**
 * Schema 0.8.1: a points item may key on more than one field. `rows` lists
 * (field, value, points) and the answer scores the BEST row it satisfies —
 * the rule `pointsFor` already applied within one field, now across two. Two
 * items on two fields would have SUMMED, and the Anlage says Nr. 7 pays only
 * "keine Punkte nach Nummer 6".
 */
describe("s25 — a points item with rows on two fields pays the best row, never the sum", () => {
  const PROV = { source_url: "https://example.gov.de/points", quote: "mindestens sechs Punkte erforderlich", retrieved_at: "2026-09-02" };
  const fixture = (): Dataset => ({
    schema_version: "0.8.1",
    dataset_version: "test",
    fields: [
      { id: "five", label: "Five?", short_label: "Five", subject: "the five", type: "enum", options: [
        { value: "lt2", label: "<2", short: "under two" }, { value: "2plus", label: "2+", short: "two or more" } ] },
      { id: "seven", label: "Seven?", short_label: "Seven", subject: "the seven", type: "enum", options: [
        { value: "lt3", label: "<3", short: "under three" }, { value: "3to5", label: "3-5", short: "three to five" },
        { value: "5plus", label: "5+", short: "five or more" }, { value: "unknown", label: "?", is_unknown: true } ] },
      { id: "german", label: "German?", short_label: "German", subject: "your German", type: "enum", options: [
        { value: "none", label: "None" }, { value: "b1", label: "B1", short: "B1 German" } ] },
    ],
    countries: [{
      code: "DE", name: "Germany",
      routes: [{
        id: "de-points-card", name: "Points card", kind: "seek", info_url: "https://example.gov.de/route",
        scope: { value: "every-deciding-rule-asked", reason: "Every rule that decides this route is a question you answer, and nothing else is stated.", not_asked: [] },
        criteria: [{
          op: "points",
          required: { value: 4, unit: "points", ...PROV },
          table: {
            ...PROV,
            items: [
              { rows: [{ field: "five", value: "2plus", points: 2 }, { field: "seven", value: "5plus", points: 3 }] },
              { field: "german", points: { b1: 2 } },
            ],
          },
        }],
      }],
    }],
  });

  it("validates", () => {
    expect(validateDataset(JSON.parse(JSON.stringify(fixture()))).ok).toBe(true);
  });

  it("scores the best row: 2, 3, and 3 — never 5", () => {
    const scored = (p: Profile) => evaluate(fixture(), p)[0]!.points!;
    expect(scored({ five: "2plus", seven: "lt3", german: "none" })).toEqual({ scored: 2, required: 4, items: [{ field: "five", points: 2 }] });
    expect(scored({ five: "lt2", seven: "5plus", german: "none" })).toEqual({ scored: 3, required: 4, items: [{ field: "seven", points: 3 }] });
    expect(scored({ five: "2plus", seven: "5plus", german: "none" })).toEqual({ scored: 3, required: 4, items: [{ field: "seven", points: 3 }] });
    expect(scored({ five: "lt2", seven: "3to5", german: "none" })).toEqual({ scored: 0, required: 4, items: [] });
  });

  it("a half-answered item counts what it knows and stays open until the other field is answered", () => {
    const r = evaluate(fixture(), { five: "2plus", german: "none" })[0]!;
    expect(r.status).toBe("hold");
    expect(r.criteria[0]!.outcome).toBe("unknown");
    expect(r.points).toEqual({ scored: 2, required: 4, items: [{ field: "five", points: 2 }] });
    expect([...informativeFields(fixture(), { five: "2plus", german: "none" })]).toContain("seven");
    // "I don't know" on the seven-year question is as open as no answer.
    expect(evaluate(fixture(), { five: "2plus", seven: "unknown", german: "none" })[0]!.criteria[0]!.outcome).toBe("unknown");
    // Fully answered and short: the gap is against the best row.
    const short = evaluate(fixture(), { five: "2plus", seven: "3to5", german: "none" })[0]!;
    expect(short.criteria[0]!.outcome).toBe("fail");
    expect(short.gap_points).toBe(2);
    // Passed on what is known: nothing more is asked.
    expect(evaluate(fixture(), { five: "2plus", german: "b1" })[0]!.status).toBe("met");
  });

  it("names both fields as read, so the interview asks both", () => {
    const [c] = fixture().countries[0]!.routes[0]!.criteria;
    expect(referencedFields(c!)).toEqual(["five", "seven", "german"]);
  });

  it("a row naming an answer the field does not offer fails the build", () => {
    const bad = fixture();
    const c = bad.countries[0]!.routes[0]!.criteria[0] as Extract<Criterion, { op: "points" }>;
    (c.table.items[0] as { rows: PointsRow[] }).rows[0]!.value = "y2in5";
    expect(validateDataset(bad).ok).toBe(false);
    const missing = fixture();
    (( missing.countries[0]!.routes[0]!.criteria[0] as Extract<Criterion, { op: "points" }>).table.items[0] as { rows: PointsRow[] }).rows[0]!.field = "experience";
    expect(validateDataset(missing).ok).toBe(false);
  });
});

describe("s25 — the dataset says so in its version, and nothing else moved", () => {
  it("the schema and the day moved on since — the item's shape stands", () => {
    // 0.8.1 was this slice's (the two-field item); 0.8.2 is s32's (a
    // statement names its question), and the day is s32's too — s23's test
    // pins it. What this case holds is that nothing here undid the item.
    expect(datasetMeta(ds).schema_version).toBe("0.8.2");
    expect(datasetMeta(ds).dataset_version).toBe("2026.09.18");
    // Nothing was read at a source by the re-keying: the rules moved against
    // snapshots already held, and every quote keeps its date. The day's newest
    // read came later, with s29's two free-movement sentences.
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-09-17");
    expect(validateDataset(clone()).ok).toBe(true);
  });

  it("only the seven routes in the table read either question", () => {
    const readers = routes()
      .filter((r) => reading(r, FIVE).length + reading(r, SEVEN).length > 0)
      .map((r) => r.id).sort();
    expect(readers).toEqual([
      "de-chancenkarte", "de-experienced-worker", "es-blue-card", "es-highly-qualified", "es-ict",
      "fr-talent-blue-card", "nl-blue-card",
    ]);
  });
});
