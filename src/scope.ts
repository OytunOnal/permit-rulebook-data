import type { Route, RouteStatement, ScopeValue } from "./types.js";
import { routeReadings, routeStatements } from "./engine.js";

export { SCOPE_VALUES } from "./types.js";

/**
 * What each scope value says, in the words the page prints.
 *
 * These are the reader's words, not ours. The first cut of this fact shipped on
 * the route-page mock as a badge reading FULLY MODELLED, which the isolated
 * critique took apart three ways: it retracted itself two sentences later, it
 * was pipeline vocabulary a stranger cannot parse, and it wore the criteria-met
 * green on a page whose one hard rule is that it never rules on the reader
 * (B3). The words below say what is asked and what is not, and nothing about a
 * pipeline.
 */
/**
 * Revision 2 (human, 2026-09-08, amending decision 3): the words now say what
 * the reader GETS rather than what our pipeline did. "Some conditions stated,
 * not asked" is a sentence about us; "quoted and dated · scored, two conditions
 * stated but not asked" is a sentence about what the reader is about to read,
 * and it counts them. The same words on every screen that states a route's
 * scope: the country index, the results card and the route page's own short
 * line.
 */
const WORDS: Record<ScopeValue, (stated: number, noted: number) => string> = {
  "every-deciding-rule-asked": () => "quoted and dated · scored against your answers",
  "some-conditions-stated-not-asked": (stated, noted) => {
    // What the source states and what we merely note are different claims, and
    // the reader is told which is which: a reading is ours, and two routes were
    // saying an authority "stated" our own note (Spec review, 2026-09-08).
    const parts = [
      stated ? `${countWords(stated)} stated but not asked` : "",
      noted ? `${countWords(noted)} we note but do not ask` : "",
    ].filter(Boolean);
    return `quoted and dated · scored, ${parts.join(" and ")}`;
  },
  "rules-quoted-nothing-asked": () => "quoted and dated · not scored",
};

/** Small numbers read as words in a sentence; larger ones stay digits. */
export const NUMBER_WORDS = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
] as const;

/**
 * A count in the words a sentence reads in: "eight routes", "two conditions".
 * One implementation, because the site prints counts too and two spellings of
 * the same number is two facts (Standards review, 2026-09-08).
 */
export function countedWords(n: number, one: string, many = `${one}s`): string {
  return `${n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : n} ${n === 1 ? one : many}`;
}

const countWords = (n: number): string => countedWords(n, "condition");

/**
 * `stated` is how many conditions the SOURCE states without our asking, and
 * `noted` how many are our own readings. Both are ignored by the two values
 * that state none, and neither has a default: a count nobody passed printed
 * "no conditions stated" (Standards review, 2026-09-08).
 */
export function scopeWords(value: ScopeValue, stated: number, noted = 0): string {
  return WORDS[value](stated, noted);
}

/**
 * The same words for a route, which knows its own counts — the split comes from
 * `statedNotAsked`, so the sentence and the evidence behind it cannot disagree.
 */
export function scopeLine(route: Route): string {
  const split = statedNotAsked(route, { split: true });
  return scopeWords(route.scope.value, split.stated.length, split.noted.length);
}

/**
 * Everything this route puts in front of a reader that the interview never
 * asks about: the conditions the authority applies beside the ones we ask
 * (preconditions, whether bare or carrying their quote), the qualifications the
 * source puts on its own answer, and our own readings of what we did not ask.
 *
 * It is the evidence behind the declared value, and the test that holds the two
 * together reads it — an authored value nothing can disagree with is a claim,
 * not a fact. What it deliberately does NOT do is derive the value: the curator
 * authors that from `exclusions.md` and the readings, and a derived check that
 * the value agrees with the route's own conditions in full is a v1.x candidate
 * recorded with this slice.
 */
export function statedNotAsked(route: Route): string[];
export function statedNotAsked(route: Route, o: { split: true }): { stated: string[]; noted: string[] };
export function statedNotAsked(
  route: Route, o: { split?: true } = {},
): string[] | { stated: string[]; noted: string[] } {
  const statements: RouteStatement[] = routeStatements(route);
  // What the authority states without our asking, and what we read into the
  // gap ourselves. The page has always shown both; the difference between them
  // is the difference between a source and an opinion.
  const stated = [...(route.preconditions ?? []), ...statements.map((x) => x.text)];
  const noted = routeReadings(route).map((r) => r.text);
  return o.split ? { stated, noted } : [...stated, ...noted];
}
