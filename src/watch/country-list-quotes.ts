import { countryVocabulary, type CountryVocabulary } from "../countries.js";

/** A quote and the source it claims to come from, named by where it stands. */
export interface ListedQuote { quote: string; source_url: string; where: string }

/**
 * Every quote the country list ships: each leg of a passport class's claim,
 * and each territory's passport (#160). Both are claims a reader is told to
 * act on — which class a passport is, whose passport to choose — so the quote
 * gate holds them to their pages as it holds the dataset's own.
 */
export function countryListQuotes(vocab: CountryVocabulary = countryVocabulary): ListedQuote[] {
  const classes = Object.entries(vocab.classes).flatMap(([id, cls]) =>
    (cls.sources ?? []).map((s) => ({ quote: s.quote, source_url: s.source_url, where: `class:${id}` })));
  const territories = (vocab.territories ?? []).map((t) =>
    ({ quote: t.source.quote, source_url: t.source.source_url, where: `territory:${t.code}` }));
  return [...classes, ...territories];
}
