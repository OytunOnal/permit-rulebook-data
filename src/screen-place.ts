import { routeStatements } from "./engine.js";
import type { Dataset } from "./types.js";

/**
 * Words that point at a place on the screen: an answer, a question, a result,
 * a route or a card "above" or "below". A notice and a route statement are
 * drawn on the result screen and on a route page alike, and a route page has
 * no answer, no questions and no routes above or below it, so a text that
 * points there is false on one of the two. "The test above" (a legal test) and
 * "below the French minimum wage" (a comparison) point at nothing on the
 * screen, and are not here.
 *
 * Declared once: the dataset check refuses them, and the site's sweep of drawn
 * pages and screens looks for them.
 */
export const SCREEN_PLACE_PHRASES: readonly string[] = ["answer", "answers", "question", "questions", "result", "results", "route", "routes", "card", "cards"]
  .flatMap((thing) => [`${thing} above`, `${thing} below`]);

// Whole words, any case, any run of white space between them: a drawn page
// breaks lines where the dataset has a single space.
const PHRASE_PATTERNS = SCREEN_PLACE_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(`\\b${phrase.split(" ").join("\\s+")}\\b`, "i"),
}));

/** The phrases of `SCREEN_PLACE_PHRASES` a text carries, in the set's order,
 * whatever their case. */
export function screenPlacePhrasesIn(text: string): string[] {
  return PHRASE_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ phrase }) => phrase);
}

/** A text the screen-place check reads, and where it is in the dataset. */
export interface CheckedText {
  path: string;
  text: string;
}

/** Every text the screen-place check reads: each notice's title and body, and
 * each route statement's text. */
export function textsCheckedForScreenPlace(dataset: Dataset): CheckedText[] {
  const notices = (dataset.notices ?? []).flatMap((n) => [
    { path: `/notices/${n.id}/title`, text: n.title },
    { path: `/notices/${n.id}/body`, text: n.body },
  ]);
  const statements = dataset.countries.flatMap((country) => country.routes.flatMap((route) =>
    routeStatements(route).map((s) => ({ path: `/countries/${country.code}/routes/${route.id}/statements/${s.id}/text`, text: s.text }))));
  return [...notices, ...statements];
}

export interface ScreenPlaceError {
  path: string;
  message: string;
  keyword: "noScreenPlace";
}

/** The gate: each checked text that carries a phrase of the set. */
export function screenPlaceErrors(dataset: Dataset): ScreenPlaceError[] {
  return textsCheckedForScreenPlace(dataset).flatMap(({ path, text }) => {
    const found = screenPlacePhrasesIn(text);
    if (found.length === 0) return [];
    return [{
      path,
      message: `"${found.join('", "')}" points at a place on the screen, and this text is drawn on the result screen and on a route page alike — say what the site does instead ("our check", "our questions", "what this site says")`,
      keyword: "noScreenPlace" as const,
    }];
  });
}
