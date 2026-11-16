import { forEachCriterion, provenancedValuesOf, referencedFields, routeStatements } from "./engine.js";
import { askedByCriterion } from "./scope.js";
import type { Dataset, Route } from "./types.js";

/**
 * The gates on which question asks a route statement: the field it names, the
 * scope's `not_asked` list, and a statement a criterion of its route quotes.
 */

export interface StatementAskingError {
  path: string;
  message: string;
  keyword: "knownStatementField" | "statementFieldNotRead" | "notAskedButAsked" | "quotedByCriterionUndecided";
}

/**
 * s32: a statement may name the question whose answer covers it, and
 * the schema knows only the shape of a field id — which fields exist,
 * and which of them this route's own rules read, is known here. A field
 * nobody asks would call the statement asked and no answer could ever
 * stand beside it; a field the route never reads would claim an asking
 * the route never does — the interview may put that question for some
 * other route, and this card would list the reader's answer to it as if
 * this route had turned on it.
 */
function statementFieldErrors(dataset: Dataset, route: Route, path: string): StatementAskingError[] {
  const errors: StatementAskingError[] = [];
  const read = new Set(route.criteria.flatMap(referencedFields));
  for (const s of routeStatements(route)) {
    if (s.field === undefined) continue;
    const where = `${path}/statements/${s.id}/field`;
    if (!dataset.fields.some((f) => f.id === s.field))
      errors.push({
        path: where,
        message: `${route.id}: "${s.id}" names the field "${s.field}", which this dataset does not ask — no answer could cover it`,
        keyword: "knownStatementField",
      });
    else if (!read.has(s.field))
      errors.push({
        path: where,
        message: `${route.id}: "${s.id}" says the ${s.field} question asks it, and no rule of the route reads ${s.field} — the statement would claim an asking the route never does`,
        keyword: "statementFieldNotRead",
      });
  }
  return errors;
}

/**
 * s19: a statement the interview asks may not be named as "not asked".
 * The scope line is derived by that rule in `statedNotAsked`; the
 * authored list is held to it here, because a list the line no longer
 * reads would go on telling data/exclusions.md that the sentence is
 * unasked. Asked was the shared sentence until s32; it is the field now.
 */
function notAskedButAskedErrors(route: Route, path: string): StatementAskingError[] {
  const errors: StatementAskingError[] = [];
  for (const s of routeStatements(route))
    if (route.scope.not_asked.includes(s.id) && askedByCriterion(s))
      errors.push({
        path: `${path}/scope/not_asked`,
        message: `${route.id} names "${s.id}" as not asked, and the statement says the ${s.field} question asks it — decide which`,
        keyword: "notAskedButAsked",
      });
  return errors;
}

/**
 * s32: the shared sentence retires as the key and stays as the
 * cross-check, the other way round. A statement whose quote a criterion
 * of this route quotes verbatim is the case s19 found — one sentence
 * read twice — and it is exactly where a blank would go unnoticed: the
 * card would list the reader's own answer under "not checked here".
 * So it must be decided in the data, one way or the other: the
 * statement carries `field`, or the scope names it in `not_asked` with
 * the curator's sentence in `reason`. Containment is deliberately not
 * read here: it was wrong twice out of three (the scenario's own
 * count), and the decision is the curator's to type.
 */
function quotedByCriterionUndecidedErrors(route: Route, path: string): StatementAskingError[] {
  const errors: StatementAskingError[] = [];
  for (const s of routeStatements(route)) {
    if (!s.source || s.field !== undefined || route.scope.not_asked.includes(s.id)) continue;
    let verbatim = false;
    forEachCriterion(route.criteria, (c) => {
      for (const p of provenancedValuesOf(c)) if (p.value.quote === s.source!.quote) verbatim = true;
    });
    if (verbatim)
      errors.push({
        path: `${path}/statements/${s.id}`,
        message: `${route.id}: a criterion quotes the sentence "${s.id}" stands on, and the statement neither names the question that asks it (field) nor is named in scope.not_asked — decide which`,
        keyword: "quotedByCriterionUndecided",
      });
  }
  return errors;
}

/** The gates on which question asks each statement of one route, at `path`. */
export function statementAskingErrors(dataset: Dataset, route: Route, path: string): StatementAskingError[] {
  return [
    ...statementFieldErrors(dataset, route, path),
    ...notAskedButAskedErrors(route, path),
    ...quotedByCriterionUndecidedErrors(route, path),
  ];
}
