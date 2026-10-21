import { countryVocabulary, type CountryVocabulary, type Territory, type VocabularyError } from "./countries.js";
import { foldForSearch, matchOptions } from "./engine.js";

/** A territory a reader typed, and the country whose passport its people hold. */
export interface FoundTerritory {
  territory: Territory;
  country: CountryVocabulary["countries"][number];
}

const namesOf = (t: Territory): string[] => [t.name, ...(t.aliases ?? [])];

/**
 * The territory whose name or alias is what the reader typed, whole — folded
 * the way the passport search folds, so case, marks and punctuation do not
 * matter — with the country whose passport its people hold. Nothing for
 * anything else: a part of a name is still a search in progress.
 */
export function findTerritory(typed: string, vocab: CountryVocabulary = countryVocabulary): FoundTerritory | undefined {
  const folded = foldForSearch(typed.trim());
  if (!folded) return undefined;
  const territory = (vocab.territories ?? []).find((t) => namesOf(t).some((n) => foldForSearch(n) === folded));
  const country = territory && vocab.countries.find((c) => c.code === territory.passport);
  return territory && country ? { territory, country } : undefined;
}

const hasProvenance = (t: Territory): boolean =>
  Boolean(t.source?.source_url && t.source.quote && t.source.retrieved_at);

/**
 * The territory list's own invariants: each names a passport on the list and
 * carries the source that says so, and none is a row — not by its code, and
 * not by a name the passport search would find a row by, or typing it would
 * show that row and the territory's line never would.
 */
export function territoryErrors(vocab: CountryVocabulary): VocabularyError[] {
  const errors: VocabularyError[] = [];
  const at = (t: Territory, message: string) =>
    errors.push({ path: `/territories/${t.code}`, message: `${t.code} (${t.name}) ${message}`, keyword: "territoryPassport" });
  const codes = new Set(vocab.countries.map((c) => c.code));
  const rows = vocab.countries.map((c) => ({ value: c.code, label: c.name, aliases: c.aliases }));
  for (const t of vocab.territories ?? []) {
    if (!t.passport) at(t, "names no passport its people hold");
    else if (!codes.has(t.passport)) at(t, `names the passport ${t.passport}, which is not on the country list`);
    if (!hasProvenance(t)) at(t, "carries no source for its passport — an official page, its quote and the day it was read");
    if (codes.has(t.code)) at(t, `is a row of the country list as ${t.code} — a territory is never a row`);
    for (const name of namesOf(t)) {
      const found = matchOptions(rows, name).map((o) => o.label);
      if (found.length) at(t, `is found as a row by "${name}" (${found.join(", ")}) — typing it would never reach the territory's line`);
    }
  }
  return errors;
}
