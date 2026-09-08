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
const WORDS: Record<ScopeValue, (stated: number) => string> = {
  "every-deciding-rule-asked": () => "quoted and dated · scored against your answers",
  "some-conditions-stated-not-asked": (stated) =>
    `quoted and dated · scored, ${countWords(stated)} stated but not asked`,
  "rules-quoted-nothing-asked": () => "quoted and dated · not scored",
};

/** Small numbers read as words in a sentence; larger ones stay digits. */
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function countWords(stated: number): string {
  const many = stated === 1 ? "condition" : "conditions";
  return `${stated < NUMBER_WORDS.length ? NUMBER_WORDS[stated] : stated} ${many}`;
}

/**
 * `stated` is how many conditions the route declares it states without asking
 * — the authored `not_asked` list, the same one the route page's full sentence
 * names. It is ignored by the two values that state none.
 */
export function scopeWords(value: ScopeValue, stated = 0): string {
  return WORDS[value](stated);
}

/** The same words for a route, which knows its own count. */
export function scopeLine(route: Route): string {
  return scopeWords(route.scope.value, route.scope.not_asked.length);
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
export function statedNotAsked(route: Route): string[] {
  const statements: RouteStatement[] = routeStatements(route);
  return [
    ...(route.preconditions ?? []),
    ...statements.map((s) => s.text),
    ...routeReadings(route).map((r) => r.text),
  ];
}
