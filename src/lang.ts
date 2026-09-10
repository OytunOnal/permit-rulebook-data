import type { Dataset } from "./types.js";
import { forEachCriterion, routeStatements, statementSources } from "./engine.js";

/**
 * What language a quote is in.
 *
 * A verbatim quote is the authority's own sentence, so most of them are not in
 * English — and a page that prints twenty-four words of German inside an
 * `<html lang="en">` document hands a screen reader English phonemes for
 * *Mindestbruttojahresgehalt* (route-page critique, F5). The page needs the tag
 * per quote, and the fact belongs beside the data rather than in a renderer.
 *
 * It is read off the source, because that is how anyone knows: the document at
 * `ind.nl/en/…` is the English edition of that page, the one at `buzer.de/…` is
 * the German statute. The map is a declared list of prefixes, longest match
 * wins, and there is deliberately **no default** — an unknown source is a
 * source nobody has looked at, and `unmappedSources` fails the build rather
 * than letting the page guess a language and tag it with confidence.
 */
export const QUOTE_LANGUAGES: ReadonlyArray<readonly [prefix: string, lang: string]> = [
  ["https://europa.eu/", "en"],
  ["https://handbookgermany.de/en/", "en"],
  ["https://ind.nl/en/", "en"],
  ["https://www.bamf.de/EN/", "en"],
  ["https://kairo.diplo.de/", "de"],
  ["https://www.arbeitsagentur.de/", "de"],
  ["https://www.buzer.de/", "de"],
  ["https://www.boe.es/", "es"],
  ["https://www.inclusion.gob.es/", "es"],
  ["https://www.service-public.gouv.fr/", "fr"],
];

/** The language's name in the reader's language, for the line beside a quote. */
export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: "English",
  de: "German",
  es: "Spanish",
  fr: "French",
};

/** The tag for one source, or undefined where no declared prefix covers it. */
export function quoteLanguage(sourceUrl: string): string | undefined {
  let best: readonly [string, string] | undefined;
  for (const entry of QUOTE_LANGUAGES)
    if (sourceUrl.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  return best?.[1];
}

/** Every source URL the dataset ships. */
export function sourceUrls(dataset: Dataset): string[] {
  const urls = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes) {
      urls.add(route.info_url);
      forEachCriterion(route.criteria, (c) => {
        if (c.source) urls.add(c.source.source_url);
        if (c.op === "gte") urls.add(c.threshold.source_url);
        if (c.op === "points") { urls.add(c.required.source_url); urls.add(c.table.source_url); }
      });
      // A carve-out's quote is a quote on a page and needs its language tagged
      // like every other (s7).
      for (const s of routeStatements(route))
        for (const value of statementSources(s)) urls.add(value.source_url);
    }
  for (const n of dataset.notices ?? []) urls.add(n.source.source_url);
  return [...urls].sort();
}

/**
 * Sources no declared prefix covers. A page cannot tag a quote it cannot name
 * the language of, and guessing is how "German" ends up on a European
 * Commission sentence — so this is a gate, not a report.
 */
export function unmappedSources(dataset: Dataset): string[] {
  return sourceUrls(dataset).filter((u) => quoteLanguage(u) === undefined);
}
