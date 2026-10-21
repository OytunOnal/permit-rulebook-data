import { deriveBands, fieldOptions } from "../src/engine.js";
import type { Dataset, FieldDef, Profile } from "../src/types.js";

/**
 * The seeded profiles the property suites draw. Deterministic, so every run
 * checks the same profile population, and one copy, so a suite's case ids and
 * outcomes stay tied to the same draw.
 */

/** A linear congruential generator: the same seed gives the same numbers in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Every answer a field offers: its bands for money, its options otherwise. */
export function optionValues(dataset: Dataset, def: FieldDef): string[] {
  if (def.type === "money_band") return deriveBands(dataset, def.id).map((b) => b.id);
  // Not `def.options`: a field may declare its option list by reference
  // (`options_from`), and the engine is what expands it.
  return fieldOptions(dataset, def.id).map((o) => o.value);
}

/**
 * Each field answered with probability `answerProb`, by a random option.
 *
 * Destination first: a money answer is a position in the ladder that
 * destination is asked, so drawing one first would put a band on a profile
 * whose own country never offers it (F12).
 */
export function randomProfile(dataset: Dataset, rand: () => number, answerProb = 1): Profile {
  const p: Profile = {};
  const fields = [...dataset.fields]
    .sort((a, b) => Number(b.id === "destination") - Number(a.id === "destination"));
  for (const def of fields)
    if (rand() < answerProb) {
      const vals = optionValues(dataset, def);
      p[def.id] = vals[Math.floor(rand() * vals.length)];
    }
  return p;
}
