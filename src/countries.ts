import vocabularyData from "../data/countries.json" with { type: "json" };
import type { FieldOption, ProvenancedText } from "./types.js";

/**
 * One class of passport, as the rules see it. The label is what a person
 * reads; `members` is a RULE — it decides who needs a work permit at all — so
 * it carries provenance like any threshold. One `sources` entry per leg of
 * the claim (EU-27 membership, the EEA Agreement, the EU–Switzerland
 * agreement): a single quote cannot establish three different treaties.
 * The class without `members` is the complement — everything not enumerated.
 */
export interface CountryClass {
  label: string;
  sources?: ProvenancedText[];
  members?: string[];
}

export interface CountryVocabulary {
  classes: Record<string, CountryClass>;
  /** ISO 3166-1 alpha-2. A vocabulary, not a rule: no per-country provenance. */
  countries: { code: string; name: string; aliases?: string[] }[];
}

export interface VocabularyError {
  path: string;
  message: string;
  keyword: string;
}

export const countryVocabulary = vocabularyData as CountryVocabulary;

/** Class labels for consumers that render an answer's class beside it. */
export const countryClasses: Record<string, CountryClass> = countryVocabulary.classes;

const enumeratedClasses = (vocab: CountryVocabulary) =>
  Object.entries(vocab.classes).filter(([, c]) => c.members !== undefined);
const complementClasses = (vocab: CountryVocabulary) =>
  Object.keys(vocab.classes).filter((id) => vocab.classes[id].members === undefined);

/** The one class a country belongs to: the class that lists it, or — for the
 * great majority that no class enumerates — the complement. */
export function classOfCountry(code: string, vocab: CountryVocabulary = countryVocabulary): string | undefined {
  for (const [id, cls] of enumeratedClasses(vocab)) if (cls.members!.includes(code)) return id;
  return complementClasses(vocab)[0];
}

/**
 * The country list as field options. `implies` is what lets a country answer
 * satisfy a criterion written against its class, so the twenty-one
 * `citizenship eq third_country` criteria never had to change and the next
 * agreement is one line of data.
 */
const derivedOptions: FieldOption[] = countryVocabulary.countries
  .map((c) => ({
    value: c.code,
    label: c.name,
    implies: [classOfCountry(c.code)!],
    // Names people still type. Search keys only — never displayed.
    ...(c.aliases?.length ? { aliases: c.aliases } : {}),
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "en"));

export function countryOptions(): FieldOption[] {
  return derivedOptions;
}

/**
 * The vocabulary's own invariants — the ones JSON Schema cannot state and
 * `validateDataset` enforces at the boundary: every country lands in exactly
 * one class, and no class claims a country the list does not carry.
 */
export function vocabularyErrors(vocab: CountryVocabulary): VocabularyError[] {
  const errors: VocabularyError[] = [];
  const at = (path: string, message: string) => errors.push({ path, message, keyword: "countryClass" });
  const codes = new Set<string>();
  for (const c of vocab.countries) {
    if (codes.has(c.code)) at(`/countries/${c.code}`, "duplicate country code");
    codes.add(c.code);
  }

  const enumerated = enumeratedClasses(vocab);
  const complements = complementClasses(vocab);
  if (complements.length === 0)
    at("/classes", `exactly one class must be the complement (no members); found ${complements.length}`);

  const claimedBy = new Map<string, string[]>();
  for (const [id, cls] of enumerated)
    for (const member of cls.members!) {
      if (!codes.has(member)) at(`/classes/${id}/members`, `${member} is not in the country list`);
      claimedBy.set(member, [...(claimedBy.get(member) ?? []), id]);
    }
  for (const [code, owners] of claimedBy)
    if (owners.length > 1)
      at(`/countries/${code}`, `claimed by more than one class (${owners.join(", ")}) — a country has exactly one`);

  if (complements.length !== 1)
    for (const c of vocab.countries)
      if (!claimedBy.has(c.code)) {
        at(`/countries/${c.code}`, "no class covers this country");
        break; // one error names the gap; two hundred would drown the report
      }
  return errors;
}
