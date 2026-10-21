import type { Profile, Route, RouteStatement, ScopeValue } from "./types.js";
import { bindsReader, routeReadings, routeStatements } from "./engine.js";

export { SCOPE_VALUES } from "./types.js";

/**
 * Whether the reader the line is printed for has answered: the results card's
 * reader has, a country or route page's has not. A line that says "checked
 * against your answers" to someone who gave none promises a check that never
 * ran, so the page that has no answers says what the checker asks instead.
 */
export type ScopeReader = "answered" | "not-answered";

/** How many unasked conditions the line counts: the source's and our readings. */
export interface UnaskedCount {
  stated: number;
  noted: number;
}

/**
 * The scope line's words, one table per reader. They say what the reader gets
 * — quoted and dated, and how much of the route the checker looks at — and
 * nothing about how the dataset is built: "scored", "this interview" and "rule
 * set" are the model's words and sit on GLOSSARY's Scope statement avoid-list.
 * Counts are figures, because the line is a tally the reader compares across
 * cards.
 */
const WORDS: Record<ScopeReader, Record<ScopeValue, string>> = {
  answered: {
    "every-deciding-rule-asked": "quoted and dated · checked against your answers",
    "some-conditions-stated-not-asked": "quoted and dated · checked against your answers, except {count} we don't ask about",
    "rules-quoted-nothing-asked": "quoted and dated · not checked against your answers",
  },
  "not-answered": {
    "every-deciding-rule-asked": "quoted and dated · the checker asks about all of it",
    "some-conditions-stated-not-asked": "quoted and dated · the checker asks about it, except {count}",
    "rules-quoted-nothing-asked": "quoted and dated · the checker does not ask about it",
  },
};

/**
 * Whose words the unasked conditions are in. A source STATES a condition; a
 * reading is ours, and the reader is told so — never "we note" (GLOSSARY,
 * Route reading).
 */
const readingsTail = (noted: number): string =>
  noted ? ` — ${noted} of them in our own words, not the authority's` : "";

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

/**
 * A tally in figures: "2 conditions", "1 condition". The scope line is the one
 * sentence that is compared across cards, so its count is a figure where the
 * prose elsewhere spells small numbers out (s23).
 */
const countFigures = (n: number): string => `${n} ${n === 1 ? "condition" : "conditions"}`;

/**
 * `unasked.stated` is how many conditions the SOURCE states without our
 * asking, and `unasked.noted` how many are our own readings; the two values
 * that state none ignore them. A route whose unasked conditions were all set
 * aside for this reader (a carve-out, s7) reads as the first form, not as a
 * sentence that counts nothing.
 */
export function scopeWords(value: ScopeValue, unasked: UnaskedCount, o: { reader: ScopeReader }): string {
  if (value !== "some-conditions-stated-not-asked") return WORDS[o.reader][value];
  const total = unasked.stated + unasked.noted;
  if (total === 0) return WORDS[o.reader]["every-deciding-rule-asked"];
  return WORDS[o.reader][value].replace("{count}", countFigures(total)) + readingsTail(unasked.noted);
}

/**
 * The same words for a route, which knows its own counts — the split comes from
 * `statedNotAsked`, so the sentence and the evidence behind it cannot disagree.
 *
 * The answered form takes the reader's answers, because a condition the
 * authority sets aside for their passport is not one of the conditions stated
 * to them (s7). A page with no answers has no reader to set anything aside
 * for, so every condition stands.
 */
export function scopeLine(
  route: Route, o: { reader: "answered"; profile: Profile } | { reader: "not-answered" },
): string {
  const profile = o.reader === "answered" ? o.profile : {};
  const split = statedNotAsked(route, { split: true, profile });
  return scopeWords(route.scope.value, { stated: split.stated.length, noted: split.noted.length }, o);
}

/**
 * Whether the interview asks this statement — whether it names the question
 * whose answer covers it.
 *
 * On es-researcher the hosting-agreement sentence was quoted twice: by the
 * situation gate the interview asks, and by a precondition the scope named as
 * not asked. The card said "scored, one condition stated but not asked" two
 * lines above "Asked in the interview — you declared …" (s19, from the site
 * half's build). One sentence is one fact — and s19 made the shared sentence
 * the key: a statement whose quote a criterion of the route quoted verbatim
 * was asked. Three more shared a sentence by containment, and read on
 * 2026-09-18 that key would have decided two of them wrongly: de-ict-card's
 * six months with the company wraps the situation gate's sentence, and a
 * tenure is not what the situation question asks. So the key is the
 * curator's decision, typed on the statement as `field` (s32). The route is
 * still the unit "asked" is about — a field is asked BY a route's criteria —
 * but it is the validator that holds the field to the fields the route reads,
 * so nothing here needs the route: the parameter it took until s32 is gone.
 * Exported for the package's own `statedNotAsked` and the validator; the site
 * reads the field itself.
 */
export function askedByCriterion(statement: RouteStatement): boolean {
  return statement.field !== undefined;
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
export function statedNotAsked(route: Route, o?: { profile?: Profile }): string[];
export function statedNotAsked(
  route: Route, o: { split: true; profile?: Profile },
): { stated: string[]; noted: string[] };
export function statedNotAsked(
  route: Route, o: { split?: true; profile?: Profile } = {},
): string[] | { stated: string[]; noted: string[] } {
  // A statement the authority itself sets aside for this reader's passport is
  // not among the conditions stated to them — the carve-out stands in its
  // place, and it is a release, not a bar (s7). With no profile nothing is set
  // aside, which is what a route page and a reader who has not answered the
  // passport question both need.
  const statements: RouteStatement[] = routeStatements(route)
    .filter((s) => bindsReader(s, o.profile ?? {}))
    // A statement that names its question (`field`) is asked — the interview
    // put the question, and counting the statement as "not asked" beside the
    // reader's own answer to it is the contradiction s19 removed.
    .filter((s) => !askedByCriterion(s));
  // What the authority states without our asking, and what we read into the
  // gap ourselves. The page has always shown both; the difference between them
  // is the difference between a source and an opinion.
  const stated = [...(route.preconditions ?? []), ...statements.map((x) => x.text)];
  const noted = routeReadings(route).map((r) => r.text);
  return o.split ? { stated, noted } : [...stated, ...noted];
}
