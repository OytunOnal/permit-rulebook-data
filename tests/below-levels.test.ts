import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import type { Dataset, FieldOption } from "../src/types.js";

const ds = dataset as unknown as Dataset;

/**
 * #151, ruling 4 (the fix round, 2026-10-21): an option for a language level
 * below the scale's first rung the question offers says what is below it, not
 * the level's own name. "German below A1 (beginner)" stood beside "German at
 * A1 (beginner)", so a results line could read "below A1 (beginner)" against
 * "needs at A1 (beginner)".
 *
 * The questions are the two the ruling names. A level's gloss is the bracket
 * its `short` ends on (#151, story 31: every option reads the same way).
 */
const LANGUAGE_QUESTIONS = ["german", "english"];

/** The words in the last bracket of an option's short: its gloss. */
const glossOf = (option: FieldOption): string | undefined => /\(([^()]*)\)[^()]*$/.exec(option.short ?? "")?.[1];

describe("a 'below' language option", () => {
  for (const id of LANGUAGE_QUESTIONS)
    it(`${id}: the option below the first level is glossed, and not with that level's gloss`, () => {
      const options = ds.fields.find((f) => f.id === id)?.options ?? [];
      const [below, level] = options;
      expect(below?.is_fallback, `precondition: ${id} opens on the option below its first level`).toBe(true);
      expect(level, `precondition: ${id} offers a level above it`).toBeDefined();
      expect(glossOf(below!), `${id}: ${below!.short}`).toBeDefined();
      expect(glossOf(level!), `${id}: ${level!.short}`).toBeDefined();
      expect(glossOf(below!), `${below!.short} beside ${level!.short}`).not.toBe(glossOf(level!));
    });
});
