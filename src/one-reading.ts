import { routeStatements } from "./engine.js";
import type { Dataset, Route } from "./types.js";

/**
 * One reading per sentence: a route quotes each sentence of a page under one
 * legal basis and one read date. A card prints each distinct quote line once,
 * a line being the quote with its legal basis and read date, so one sentence
 * read twice on a route prints twice; and a shorter quote contained in a
 * longer one from the same page is left to the longer only where both carry
 * one legal basis and read date, so dropping it loses nothing.
 *
 * Reads every quoted value of every route, statements and carve-outs
 * included. A value's `history` holds its superseded readings, which no card
 * prints, so it is not read.
 */

/** A route's value that quotes a page, and where it sits in the dataset. */
export interface QuotedValue {
  path: string;
  source_url: string;
  quote: string;
  retrieved_at: string;
  legal_basis?: string;
}

/** Two quoted values of one route reading one sentence of one page: the same
 * quote, or the shorter contained in the longer. */
export interface SentencePair {
  route: string;
  kind: "same" | "contained";
  first: QuotedValue;
  second: QuotedValue;
}

export interface OneReadingError {
  path: string;
  message: string;
  keyword: "oneReadingPerSentence";
}

// A quote ending on its sentence's full stop or an ellipsis is still contained
// in a longer quote whose sentence runs on past that point.
const SENTENCE_END = /[.…]+$/;

/** Every pair of a route's quoted values reading one sentence of one page,
 * route by route, in dataset order. */
export function sentencePairsOf(dataset: Dataset): SentencePair[] {
  return dataset.countries.flatMap((country) => country.routes.flatMap((route) => {
    const values = quotedValuesOf(route, `/countries/${country.code}/routes/${route.id}`);
    return values.flatMap((first, i) => values.slice(i + 1).flatMap((second): SentencePair[] => {
      const kind = sharedSentenceKindOf(first, second);
      return kind ? [{ route: route.id, kind, first, second }] : [];
    }));
  }));
}

/** The gate: each pair reading one sentence under two legal bases or read dates. */
export function oneReadingErrors(dataset: Dataset): OneReadingError[] {
  return sentencePairsOf(dataset)
    .filter(({ first, second }) => readingOf(first) !== readingOf(second))
    .map(({ route, kind, first, second }) => ({
      path: second.path,
      message: `${route} quotes ${kind === "same" ? "one sentence" : "a sentence and a longer one containing it"} of ${first.source_url} at ${first.path} (${readingOf(first)}) and at ${second.path} (${readingOf(second)}) — read the page and give both one legal basis and one read date`,
      keyword: "oneReadingPerSentence" as const,
    }));
}

/** A route's quoted values: its statements under their ids, the rest under their places. */
function quotedValuesOf(route: Route, routePath: string): QuotedValue[] {
  const outsideStatements = Object.entries(route).filter(([key]) => key !== "statements");
  return [
    ...outsideStatements.flatMap(([key, value]) => quotedValuesUnder(value, `${routePath}/${key}`)),
    ...routeStatements(route).flatMap((s) => quotedValuesUnder(s, `${routePath}/statements/${s.id}`)),
  ];
}

function quotedValuesUnder(node: unknown, path: string): QuotedValue[] {
  if (Array.isArray(node)) return node.flatMap((item, i) => quotedValuesUnder(item, `${path}/${i}`));
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const below = Object.entries(record)
    .filter(([key]) => key !== "history")
    .flatMap(([key, value]) => quotedValuesUnder(value, `${path}/${key}`));
  return isQuotedValue(record) ? [{ ...quotedFieldsOf(record), path }, ...below] : below;
}

function isQuotedValue(record: Record<string, unknown>): record is Record<string, unknown> & Omit<QuotedValue, "path"> {
  return typeof record.quote === "string" && typeof record.source_url === "string" && typeof record.retrieved_at === "string";
}

function quotedFieldsOf(value: Omit<QuotedValue, "path">): Omit<QuotedValue, "path"> {
  const { source_url, quote, retrieved_at, legal_basis } = value;
  return { source_url, quote, retrieved_at, legal_basis };
}

/** How two values read one sentence of one page, where they do. */
function sharedSentenceKindOf(a: QuotedValue, b: QuotedValue): SentencePair["kind"] | undefined {
  if (a.source_url !== b.source_url) return undefined;
  if (a.quote === b.quote) return "same";
  const [shorter, longer] = a.quote.length < b.quote.length ? [a, b] : [b, a];
  return longer.quote.includes(shorter.quote.replace(SENTENCE_END, "")) ? "contained" : undefined;
}

/** The legal basis and read date a value prints beside its quote. */
function readingOf(value: QuotedValue): string {
  return `${value.legal_basis ?? "no legal basis"}, read ${value.retrieved_at}`;
}
