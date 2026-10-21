import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindsReader, deriveBands, evaluate, fieldOptions, routeStatements } from "../src/engine.js";
import { remainingQuestions } from "../src/questions.js";
import { classOfCountry, countryOptions } from "../src/countries.js";
import type { CriterionResult, Dataset, FieldDef, FieldOption, Profile } from "../src/types.js";

/**
 * Every question the interview asks changes something the reader sees.
 *
 * The passport was asked of every reader and then used in exactly one way —
 * "is this a third-country national" — so two third-country passports produced
 * the same screen for every route, while the IND itself sets the
 * recognised-sponsor rule aside for one of them (data #7, #8; s7). The rubric
 * now names this: an answer that changes nothing the user sees is a finding —
 * either the question goes, or it is evidence of a missing rule (steward-48).
 *
 * The check is generated, not enumerated: for each field, hold everything
 * else fixed and walk the field's answers; somewhere across a handful of
 * baselines, two answers must make some route decide differently. For the passport
 * the pool is third-country passports only, because a free-movement passport
 * changing everything was already true when #8 was open.
 */
const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const thirdCountry = countryOptions()
  .map((o) => o.value)
  .filter((code) => classOfCountry(code) === "third_country");

/**
 * Every answer the question offers, the passport's EU ones included: on one
 * destination, a free-movement passport is often the only one that moves a
 * decision, and that is the passport doing its work there.
 */
function everyAnswerTo(def: FieldDef): string[] {
  if (def.type === "money_band") return deriveBands(dataset, def.id).map((b) => b.id);
  return fieldOptions(dataset, def.id).map((o) => o.value);
}

/** Every answer the question offers, the passport a third-country one. */
function answersFor(def: FieldDef): string[] {
  return def.id === "citizenship" ? thirdCountry : everyAnswerTo(def);
}

/** A full profile, every field answered, the passport a third-country one. */
function baseline(seed: number, destination: string): Profile {
  const rand = lcg(seed);
  const p: Profile = {};
  for (const def of dataset.fields) {
    const vals = answersFor(def);
    p[def.id] = vals[Math.floor(rand() * vals.length)]!;
  }
  p["destination"] = destination;
  return p;
}

/** Each criterion's outcome, a disjunction's with the path it rested on and that path's own outcomes. */
function outcomesOf(results: CriterionResult[]): unknown[] {
  return results.map((cr) => (cr.path ? [cr.outcome, cr.path.index, outcomesOf(cr.path.criteria)] : cr.outcome));
}

/**
 * What every route decided for this profile, as one string: its status, its
 * hard fail, the rules it found unmet and the deciding path of each
 * disjunction, its gaps, and which of its stated conditions bind this reader
 * (a carve-out sets one aside for a passport the authority names). Never the
 * reason's words: a reason quotes the reader's own answer back, so two answers
 * read differently even where every route decides the same. Every route's
 * decisions, or only the given routes'.
 */
function decisions(profile: Profile, routes?: ReadonlySet<string>): string {
  return JSON.stringify(evaluate(dataset, profile)
    .filter((r) => !routes || routes.has(r.route.id))
    .map((r) => [
      r.route.id, r.status, r.hard_fail, outcomesOf(r.criteria), r.gap_max ?? null, r.gap_points ?? null,
      routeStatements(r.route).filter((s) => bindsReader(s, profile)).map((s) => s.id),
    ]));
}

const SEEDS = 60;

/**
 * Whether two of these answers to the field give two different decisions on
 * some baseline for the destination: every route's, or only the given
 * routes'.
 */
function answersMoveDecisions(
  field: string, answers: string[], where: { destination: string; routes?: ReadonlySet<string> },
): boolean {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const base = baseline(seed, where.destination);
    const seen = new Set<string>();
    for (const value of answers) {
      seen.add(decisions({ ...base, [field]: value }, where.routes));
      if (seen.size > 1) return true;
    }
  }
  return false;
}

describe("every question does work", () => {
  const destinations = fieldOptions(dataset, "destination").map((o) => o.value);
  const asked = dataset.fields.filter((f) => f.id !== "destination");

  for (const def of asked)
    it(`${def.id}: two answers produce two different decisions`, () => {
      const answers = answersFor(def);
      expect(answers.length, `${def.id} has fewer than two answers to compare`).toBeGreaterThan(1);
      // A field the interview asks only for one country changes nothing under
      // another, so every destination gets a turn — and enough seeds that a
      // one-point field on the Chancenkarte meets a baseline sitting one point
      // short: with three seeds it never did, and the test blamed the question.
      const moved = destinations.some((destination) => answersMoveDecisions(def.id, answers, { destination }));
      expect(
        moved,
        `${def.id}: no two answers change any route's decision — either the question goes, `
          + `or a rule is missing (the passport was this, data #8)`,
      ).toBe(true);
    });

  it("the passport is decided by more than the free-movement class", () => {
    // The instance that opened #8, kept as its own line: a Turkish and a
    // Japanese passport on the Dutch highly skilled migrant route see
    // different conditions, because the IND says so.
    const base = baseline(1, "nl");
    const tr = decisions({ ...base, citizenship: "TR" });
    const jp = decisions({ ...base, citizenship: "JP" });
    expect(tr).not.toBe(jp);
  });
});

/**
 * The check above passes a field when any destination moves, so the
 * seven-year question passed on Spain, the Netherlands and France while
 * "Under 3" and "3 to under 5" gave every German card the same result (B1,
 * #133). These checks hold each destination to its own decisions, and each pair
 * of neighbouring rungs of an improvable enum to a difference of its own.
 */
describe("every question does work on every destination it is asked on", () => {
  const destinations = fieldOptions(dataset, "destination").map((o) => o.value);

  /** The routes a destination answer leaves open, the engine told only that. */
  function openRoutesOf(destination: string): Set<string> {
    return new Set(evaluate(dataset, { destination }).filter((r) => !r.hard_fail).map((r) => r.route.id));
  }

  const askedOn = new Map<string, Set<string>>();
  /**
   * The fields the interview offers on this destination: every question
   * `remainingQuestions` lists at any step of an interview answered from each
   * baseline.
   */
  function fieldsAskedOn(destination: string): Set<string> {
    const cached = askedOn.get(destination);
    if (cached) return cached;
    const asked = new Set<string>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const answers = baseline(seed, destination);
      const profile: Profile = { destination };
      for (let step = 0; step <= dataset.fields.length; step++) {
        const offered = remainingQuestions(dataset, profile);
        if (offered.length === 0) break;
        for (const q of offered) asked.add(q.field);
        profile[offered[0]!.field] = answers[offered[0]!.field];
      }
    }
    askedOn.set(destination, asked);
    return asked;
  }

  /** Whether two of these answers to the field move a decision of a route
   * the destination leaves open, on some baseline. */
  const answersMoveDestination = (destination: string, field: string, answers: string[]): boolean =>
    answersMoveDecisions(field, answers, { destination, routes: openRoutesOf(destination) });

  it("per destination: a field asked on a destination moves that destination's decisions", () => {
    const failures: string[] = [];
    for (const destination of destinations)
      for (const def of dataset.fields) {
        if (!fieldsAskedOn(destination).has(def.id)) continue;
        if (!answersMoveDestination(destination, def.id, everyAnswerTo(def)))
          failures.push(`${destination}: ${def.id} is asked there, but no change of its answer moves that destination's decisions`);
      }
    expect(failures).toEqual([]);
  });

  /**
   * An improvable enum: an enum the reader can climb, its options rungs in
   * order. A money band is not one (its edges are global until #89 cuts them
   * per destination), and neither is an enum the reader cannot improve, such
   * as the passport, which gives one result for most countries by design.
   */
  function isImprovableEnum(def: FieldDef): boolean {
    return def.type === "enum" && def.kind === "improvable";
  }

  /** An improvable enum's rungs in order; "I don't know" is an answer, not a rung. */
  function rungsOf(def: FieldDef): FieldOption[] {
    return fieldOptions(dataset, def.id).filter((o) => !o.is_unknown);
  }

  interface SameRungs {
    destination: string;
    field: string;
    rungs: [string, string];
  }

  /**
   * Neighbouring rungs known to read the same on a destination, each owned by
   * an open issue or a ruling. France reads the seven-year question only as
   * "5 years or more", so its lower two rungs cannot differ there until
   * OytunOnal/permit-rulebook#89 cuts ladder rungs per destination; the entry
   * goes when #89 lands. "Not assessed yet" and "Assessed and not recognised"
   * are two situations a reader tells apart that every rule reads alike, by
   * ruling (OytunOnal/permit-rulebook#92, ruling 9), wherever Germany is
   * asked. The check fails when an entry stops failing.
   */
  const KNOWN_SAME_RUNGS: SameRungs[] = [
    { destination: "de", field: "recognition_de", rungs: ["not_assessed", "not_recognised"] }, // OytunOnal/permit-rulebook#92, ruling 9
    { destination: "fr", field: "experience_7y", rungs: ["lt3", "3to5"] }, // OytunOnal/permit-rulebook#89
    { destination: "all", field: "recognition_de", rungs: ["not_assessed", "not_recognised"] }, // OytunOnal/permit-rulebook#92, ruling 9
  ];

  it("per rung: neighbouring rungs of an improvable enum move the decisions of every destination it is asked on", () => {
    const rungsReadingTheSame: SameRungs[] = [];
    const messages: string[] = [];
    for (const destination of destinations)
      for (const def of dataset.fields.filter(isImprovableEnum)) {
        if (!fieldsAskedOn(destination).has(def.id)) continue;
        const rungs = rungsOf(def);
        for (let i = 1; i < rungs.length; i++) {
          const [lower, upper] = [rungs[i - 1]!, rungs[i]!];
          if (answersMoveDestination(destination, def.id, [lower.value, upper.value])) continue;
          rungsReadingTheSame.push({ destination, field: def.id, rungs: [lower.value, upper.value] });
          messages.push(`${destination}: ${def.id}: "${lower.label}" and "${upper.label}" give that destination the same decisions on every baseline`);
        }
      }
    expect(rungsReadingTheSame, `neighbouring rungs that read the same, against the known list:\n${messages.join("\n")}`)
      .toEqual(KNOWN_SAME_RUNGS);
  });
});
