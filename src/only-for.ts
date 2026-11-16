import { fieldOptions, routeStatements } from "./engine.js";
import { CITIZENSHIP_FIELD } from "./types.js";
import type { Dataset } from "./types.js";

export interface OnlyForError {
  path: string;
  message: string;
  keyword: "offeredPassport" | "carveOutOrOnlyFor";
}

/**
 * The gate on Passport-only statements.
 *
 * A Passport-only statement may only name a passport the citizenship question
 * offers. Its membership is exact, so a class or an unknown code would match
 * no declared passport, and the statement would vanish from every reader who
 * answered — with nothing saying so.
 *
 * A statement names either whom it leaves out (a carve-out) or whom it is
 * about (`onlyFor`), never both: the two together would leave the card to
 * decide which one a reader's passport answers to.
 */
export function onlyForErrors(dataset: Dataset): OnlyForError[] {
  const passports = new Set(fieldOptions(dataset, CITIZENSHIP_FIELD).map((o) => o.value));
  return dataset.countries.flatMap((country) => country.routes.flatMap((route) =>
    routeStatements(route).flatMap((s): OnlyForError[] => {
      const path = `/countries/${country.code}/routes/${route.id}/statements/${s.id}`;
      const unoffered = (s.onlyFor?.citizenship ?? []).filter((v) => !passports.has(v)).map((v) => ({
        path: `${path}/onlyFor`,
        message: `${route.id}: "${s.id}" is only for ${CITIZENSHIP_FIELD} "${v}", which the ${CITIZENSHIP_FIELD} question does not offer — no declared passport could match it`,
        keyword: "offeredPassport" as const,
      }));
      const both = s.except && s.onlyFor ? [{
        path,
        message: `${route.id}: "${s.id}" names both the passports it does not bind (except) and the only passports it is about (onlyFor) — keep one`,
        keyword: "carveOutOrOnlyFor" as const,
      }] : [];
      return [...unoffered, ...both];
    })));
}
