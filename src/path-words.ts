import { forEachCriterion, routeStatements } from "./engine.js";
import type { Disjunction } from "./disjunction.js";
import type { Country, Dataset, Route } from "./types.js";

/**
 * A path's words (`subject`) are what a card says when it names the path a
 * route was met through, and a precondition that belongs to one path names it
 * by those words (`path`). This gate reads a route's criteria with paths and
 * its statements, and refuses: a criterion where some paths carry words and
 * some do not, since a card would name one path and fall silent on another;
 * two paths of one route with the same words, which a link could not tell
 * apart; a link from a caveat, which binds no path; and a link to words no
 * path of the route carries, since a typo would keep the condition on the card
 * whichever path the route was met through.
 */

export interface PathWordsError {
  path: string;
  message: string;
  keyword: "pathWordsOnEveryPath" | "pathWordsDistinct" | "statementPathOnPreconditionOnly" | "knownStatementPath";
}

/** Every criterion with paths in a route, nested ones included. */
export function disjunctionsOf(route: Route): Disjunction[] {
  const found: Disjunction[] = [];
  forEachCriterion(route.criteria, (c) => { if (c.op === "any") found.push(c); });
  return found;
}

/** Each criterion of the route where only some paths carry words. */
function partlyWordedErrors(where: string, route: Route): PathWordsError[] {
  return disjunctionsOf(route)
    .filter((c) => c.paths.some((p) => p.subject !== undefined) && c.paths.some((p) => p.subject === undefined))
    .map((c) => ({
      path: where,
      message: `${route.id}: "${c.label}" gives words to some of its paths and not others — give every path a "subject", or none`,
      keyword: "pathWordsOnEveryPath" as const,
    }));
}

/** Each set of words two or more paths of the route share. */
function sharedWordsErrors(where: string, route: Route, words: string[]): PathWordsError[] {
  const shared = [...new Set(words.filter((w, i) => words.indexOf(w) !== i))];
  return shared.map((w) => ({
    path: where,
    message: `${route.id}: two paths are both "${w}" — a precondition's path could not say which`,
    keyword: "pathWordsDistinct" as const,
  }));
}

/** Each statement of the route whose `path` is on a caveat or names no worded path of the route. */
function statementPathErrors(where: string, route: Route, words: string[]): PathWordsError[] {
  return routeStatements(route).flatMap((s): PathWordsError[] => {
    if (s.path === undefined) return [];
    const at = `${where}/statements/${s.id}/path`;
    if (s.kind !== "precondition")
      return [{ path: at, message: `${route.id}: "${s.id}" is a ${s.kind} and names the path "${s.path}" — only a precondition belongs to a path`, keyword: "statementPathOnPreconditionOnly" }];
    if (!words.includes(s.path))
      return [{ path: at, message: `${route.id}: "${s.id}" belongs to the path "${s.path}", which no path of this route is — the card could never drop it, and would show it whichever path the route was met through`, keyword: "knownStatementPath" }];
    return [];
  });
}

function routeErrors(country: Country, route: Route): PathWordsError[] {
  const where = `/countries/${country.code}/routes/${route.id}`;
  const words = disjunctionsOf(route).flatMap((c) => c.paths.flatMap((p) => (p.subject === undefined ? [] : [p.subject])));
  return [
    ...partlyWordedErrors(where, route),
    ...sharedWordsErrors(where, route, words),
    ...statementPathErrors(where, route, words),
  ];
}

/** The gate over every route's path words and every statement's path. */
export function pathWordsErrors(dataset: Dataset): PathWordsError[] {
  return dataset.countries.flatMap((country) => country.routes.flatMap((route) => routeErrors(country, route)));
}
