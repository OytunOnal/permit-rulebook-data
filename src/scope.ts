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
const WORDS: Record<ScopeValue, string> = {
  "every-deciding-rule-asked": "every deciding rule asked",
  "some-conditions-stated-not-asked": "some conditions stated, not asked",
  "rules-quoted-nothing-asked": "rules quoted, nothing asked",
};

export function scopeWords(value: ScopeValue): string {
  return WORDS[value];
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
