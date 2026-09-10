import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindsReader, deriveBands, evaluate, fieldOptions, routeStatements } from "../src/engine.js";
import { reasonFor } from "../src/verdict.js";
import { scopeLine } from "../src/scope.js";
import { classOfCountry, countryOptions } from "../src/countries.js";
import type { Dataset, FieldDef, Profile } from "../src/types.js";

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
 * baselines, two answers must produce two different screens. For the passport
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

function answersFor(def: FieldDef): string[] {
  if (def.id === "citizenship") return thirdCountry;
  if (def.type === "money_band") return deriveBands(dataset, def.id).map((b) => b.id);
  return fieldOptions(dataset, def.id).map((o) => o.value);
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

/** Everything on the screen that an answer could move, as one string. */
function screen(profile: Profile): string {
  const out: string[] = [];
  for (const r of evaluate(dataset, profile)) {
    const reason = reasonFor(dataset, r, profile);
    out.push(r.route.id, reason.line, ...reason.rows.map((x) => x.text));
    out.push(...routeStatements(r.route).filter((s) => bindsReader(s, profile)).map((s) => s.id));
    out.push(scopeLine(r.route, profile));
  }
  return out.join("\n");
}

const SEEDS = 60;

describe("every question does work", () => {
  const destinations = fieldOptions(dataset, "destination").map((o) => o.value);
  const asked = dataset.fields.filter((f) => f.id !== "destination");

  for (const def of asked)
    it(`${def.id}: two answers produce two different screens`, () => {
      const answers = answersFor(def);
      expect(answers.length, `${def.id} has fewer than two answers to compare`).toBeGreaterThan(1);
      let moved = false;
      // A field the interview asks only for one country changes nothing under
      // another, so every destination gets a turn — and enough seeds that a
      // one-point field on the Chancenkarte meets a baseline sitting one point
      // short: with three seeds it never did, and the test blamed the question.
      outer: for (const destination of destinations)
        for (let seed = 1; seed <= SEEDS; seed++) {
          const base = baseline(seed, destination);
          const seen = new Set<string>();
          for (const value of answers) {
            seen.add(screen({ ...base, [def.id]: value }));
            if (seen.size > 1) { moved = true; break outer; }
          }
        }
      expect(
        moved,
        `${def.id}: no two answers change anything a reader sees — either the question goes, `
          + `or a rule is missing (the passport was this, data #8)`,
      ).toBe(true);
    });

  it("the passport is decided by more than the free-movement class", () => {
    // The instance that opened #8, kept as its own line: a Turkish and a
    // Japanese passport on the Dutch highly skilled migrant route see
    // different conditions, because the IND says so.
    const base = baseline(1, "nl");
    const tr = screen({ ...base, citizenship: "TR" });
    const jp = screen({ ...base, citizenship: "JP" });
    expect(tr).not.toBe(jp);
  });
});
