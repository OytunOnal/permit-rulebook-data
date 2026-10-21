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
  /** The class as a noun phrase inside a sentence ("a non-EU passport") — a
   * criterion written against a class has no option to borrow words from. */
  short: string;
  sources?: ProvenancedText[];
  members?: string[];
}

export interface CountryVocabulary {
  classes: Record<string, CountryClass>;
  /** ISO 3166-1 alpha-2. A vocabulary, not a rule: no per-country provenance. */
  /** `article` is the word the name takes inside a sentence ("the"
   * Netherlands) — a fact about the country, kept beside its name. So is
   * `adjective`: the word a sentence uses for a thing OF that country, which
   * English does not derive from the name ("Spain" → "Spanish", "the
   * Netherlands" → "Dutch"). It is carried for the countries this product
   * writes prose about, which is the ones it ships routes for. */
  countries: { code: string; name: string; article?: string; adjective?: string; aliases?: string[] }[];
  /** Places a reader may type that are not passport issuers, kept beside the
   * rows and never among them: see `Territory`. */
  territories?: Territory[];
}

/**
 * A dependent territory: not a row of the passport list, because its people
 * hold the passport of the country it belongs to. `passport` is a claim about
 * who those people are, so it carries its source like any value; a territory
 * nobody has sourced is not listed at all. `name` and `aliases` are what a
 * reader types, never a row's label.
 */
export interface Territory {
  /** ISO 3166-1 alpha-2. */
  code: string;
  name: string;
  /** The word the name takes inside a sentence ("the" Faroe Islands), as a
   * country's `article` is. */
  article?: string;
  aliases?: string[];
  /** The code of the passport its people hold — a country on the list. */
  passport: string;
  source: ProvenancedText;
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
    // The prose form, where it differs from the name: a sentence says "in the
    // Netherlands", a button in a list says "Netherlands".
    ...(c.article ? { short: phraseWithArticleOf(c) } : {}),
    implies: [classOfCountry(c.code)!],
    // Names people still type. Search keys only — never displayed.
    ...(c.aliases?.length ? { aliases: c.aliases } : {}),
  }))
  .sort((a, b) => a.label.localeCompare(b.label, "en"));

/** The list's entry for a code. A code the list does not hold throws: a
 * sentence with a bare code or a blank where a country belongs is worse than a
 * build that stops. */
function countryOf(code: string, vocab: CountryVocabulary): CountryVocabulary["countries"][number] {
  const country = vocab.countries.find((c) => c.code === code);
  if (!country) throw new Error(`country ${code} is not in the country list`);
  return country;
}

/**
 * A country's name as it reads inside a sentence: "Germany", "the Netherlands".
 *
 * The article is a fact about the country, so it lives beside the name in
 * `countries.json` rather than in a set of exceptions inside a renderer.
 */
export function phraseOf(code: string, vocab: CountryVocabulary = countryVocabulary): string {
  return phraseWithArticleOf(countryOf(code, vocab));
}

/** A name with the article it takes inside a sentence, where it takes one:
 * "the Netherlands", "Germany". A country's and a territory's alike. */
export function phraseWithArticleOf(named: { name: string; article?: string }): string {
  return named.article ? `${named.article} ${named.name}` : named.name;
}

/** A phrase as it opens a sentence or a heading: its first letter a capital. */
export function openingCapitalOf(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/** The same phrase where it opens a sentence or a heading: "The Netherlands". */
export function phraseAtStartOf(code: string, vocab: CountryVocabulary = countryVocabulary): string {
  return openingCapitalOf(phraseOf(code, vocab));
}

/** The phrase as a possessive: "Germany's", "the Netherlands'" — a name
 * ending in s takes the apostrophe alone. */
export function possessiveOf(code: string, vocab: CountryVocabulary = countryVocabulary): string {
  const phrase = phraseOf(code, vocab);
  return phrase.endsWith("s") ? `${phrase}'` : `${phrase}'s`;
}

/** The possessive where it opens a sentence or a heading: "The Netherlands'". */
export function possessiveAtStartOf(code: string, vocab: CountryVocabulary = countryVocabulary): string {
  return openingCapitalOf(possessiveOf(code, vocab));
}

/**
 * The word a sentence uses for a thing OF a country — "a Spanish source", "a
 * Dutch page". English does not derive it from the name, so it is data beside
 * the name like the article is, and it is absent for the countries nothing
 * writes prose about.
 */
export function countryAdjective(
  code: string, vocab: CountryVocabulary = countryVocabulary,
): string | undefined {
  return vocab.countries.find((c) => c.code === code)?.adjective;
}

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
