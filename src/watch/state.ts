import { forEachCriterion, noticeSources, provenancedValuesOf, routeStatements, statementSources } from "../engine.js";
import { countryAdjective, countryVocabulary } from "../countries.js";
import { joinAnd } from "../verdict.js";
import { countedWords } from "../scope.js";
import type { Dataset, UnsourcedReasonWord } from "../types.js";

/**
 * What the watch remembers between runs, and what can be read off it.
 *
 * It lives apart from `core.ts` because the site reads it too: the shape, the
 * walk from a source to the values it backs, and the one sentence a partial run
 * owes the reader are all derivations over this file, with nothing to fetch and
 * no Node built-in in sight. `core.ts` is what WRITES it.
 */

export interface Snapshot {
  /** What "changed" is decided on: the normalized text where a strategy can
   * read one, the file's own bytes where it cannot. */
  hash: string;
  /**
   * The day THIS reading was first taken — not the day the source was last
   * read. A page that answers and has not moved keeps the date its current
   * text was first seen, which is the date the dataset's values beside it
   * carry, and the date a reader sees on the card.
   */
  retrieved_at: string;
  /** normalized text kept for html and pdf-text entries so a change can quote
   * its diff context — and so the quote gate has something to check against */
  text?: string;
  /** pdf-text only: the file's own hash, kept beside the words. The words are
   * what a change means; the bytes are what a re-export moves. */
  bytes_hash?: string;
  /** pdf-text only: why this snapshot carries no `text`, in the dataset's own
   * vocabulary, so the quote gate can say WHY it cannot check rather than
   * leaving a reader with "never fetched". A text strategy may give exactly
   * one answer here: the document is a picture of a page. */
  unverifiable_reason?: UnsourcedReasonWord;
  history: { hash: string; retrieved_at: string }[];
  /**
   * The slice this reading was taken through, fingerprinted.
   *
   * A slice decides WHICH region of a page is watched, so moving one changes
   * the hash without the authority touching a word — and the next run reports
   * our own edit as "changed". It happened twice: the buzer statutes were
   * bound to their bodies on 2026-09-08 and the baseline was not re-read, so
   * the run of 2026-09-09 filed three flags and three issues about text that
   * had not moved at all (today's slice was a substring of yesterday's).
   * Recording it here lets a test say so before the watch does.
   */
  slice_read?: string;
}

/** A source the run asked for and did not get. */
export interface UnreadEntry {
  id: string;
  /** The page itself, because the state travels without the watchlist: the
   * site is shipped `watch/state.json` and nothing else from the watch. */
  url: string;
}

export interface WatchState {
  entries: Record<string, Snapshot>;
  /**
   * When the watch last ran, changed or not — an ISO day.
   *
   * The site said the corner date moved on its own, which was not true: that
   * date is the newest `retrieved_at` in the dataset and only a person changes
   * it. What DOES move by itself is this: the day every source was last
   * re-read. The site prints it, so "checked daily" is a claim a reader can
   * check (devils-advocate, 2026-09-08).
   *
   * It is also the repository's own heartbeat: a run that writes it keeps the
   * schedule alive past GitHub's sixty quiet days.
   */
  last_run?: string;
  /**
   * The sources that run could not read, named by the run itself.
   *
   * It is here because nothing else in this file can answer the question. A
   * source that answered and had not changed keeps the date its current
   * reading was taken; a source that refused the runner keeps the same
   * snapshot for the same reason — so "was this read today" is not derivable
   * from a date, and s11 was specified believing it was. The run holds the
   * answer for the length of one pass and this is where it puts it, in the
   * same breath as `last_run`, from the same reports.
   *
   * An absent list is a state written before any run recorded one: it claims
   * nothing, and nothing is said about it.
   */
  unread?: UnreadEntry[];
  /**
   * Each source's recent silent mornings — the ISO days, ascending, inside
   * the week of runs ending with the one that wrote this.
   *
   * It is a second list and not a field on `unread` because the two answer
   * different questions and only one of them is the site's. `unread` is what
   * THIS run could not read, which is what `/data/` counts; this is what the
   * BRAKE counts, and a source that read clean this morning still belongs to
   * it if it was silent on Tuesday. Holding both on one item would mean
   * either listing a source the run did read as unread, or forgetting its
   * earlier mornings the moment it answered — which is exactly the hole the
   * first rule had (DECISIONS 2026-09-24).
   *
   * A day older than the week is forgotten rather than kept: the claim this
   * watch makes is about a week, and a source silent twice in a fortnight has
   * not broken it.
   *
   * Absent on a state written before 2026-09-24. Such a state lists the
   * sources its run could not read and says nothing about any other day, so
   * each of them counts as one silent morning on that run's own date.
   */
  lapses?: Record<string, string[]>;
}

/** Does this dataset read the country vocabulary at all? */
export function usesCountryVocabulary(dataset: Dataset): boolean {
  return dataset.fields.some((f) => f.options_from === "countries");
}

/**
 * Every provenanced source_url in the dataset, with the countries whose routes
 * cite it — via the single exhaustive criterion walk, so a new op cannot
 * silently escape the coverage gate.
 *
 * A url with no country is one no route cites: a notice's authority, a passport
 * class's treaty. Coverage still requires it to be watched; a sentence about
 * what a reader is looking at cannot name a country for it.
 */
/**
 * The walk, kept per dataset — the same shape `verdict.ts` keeps its field
 * index in, and for the same reason. Every page of a build asks this question
 * once through its footer, and thirty-four walks of every route's provenance
 * to answer a question whose answer cannot have changed is the second walk the
 * footer was already written to avoid (Standards review, 2026-09-15).
 */
const walkCache = new WeakMap<Dataset, Map<string, Set<string>>>();

export function datasetSourceCountries(dataset: Dataset): Map<string, Set<string>> {
  const cached = walkCache.get(dataset);
  if (cached) return cached;
  const urls = new Map<string, Set<string>>();
  const add = (url: string, country?: string) => {
    const owners = urls.get(url) ?? new Set<string>();
    if (country) owners.add(country);
    urls.set(url, owners);
  };
  for (const country of dataset.countries)
    for (const route of country.routes) {
      forEachCriterion(route.criteria, (c) => {
        for (const p of provenancedValuesOf(c)) add(p.value.source_url, country.code);
      });
      // A route statement rests on a quote like every other value, and so does
      // the carve-out that says whom it does not bind (s7).
      for (const s of routeStatements(route))
        for (const value of statementSources(s)) add(value.source_url, country.code);
    }
  // A notice rests on a quote like every other value — it is watched like one,
  // and a notice that reports two authorities disagreeing rests on both (s8).
  for (const n of dataset.notices ?? [])
    for (const value of noticeSources(n)) add(value.source_url);
  // So does a passport class: its member list decides who needs a permit at
  // all, so every leg of that claim is watched like a threshold — but only for
  // a dataset that reads the vocabulary. Folding it in unconditionally made the
  // gate fail on a ruleset that never mentions a country (review).
  if (usesCountryVocabulary(dataset))
    for (const cls of Object.values(countryVocabulary.classes))
      for (const source of cls.sources ?? []) add(source.source_url);
  walkCache.set(dataset, urls);
  return urls;
}

/** Every provenanced source_url in the dataset — the keys of the walk above. */
export function datasetSourceUrls(dataset: Dataset): Set<string> {
  return new Set(datasetSourceCountries(dataset).keys());
}

/** A source the last run did not read, and what a reader is looking at because of it. */
export interface UnreadSource {
  id: string;
  url: string;
  /** The day the reading still on the site was taken — the date beside every
   * value this source backs. */
  last_read: string;
  /** The countries whose routes cite it, in dataset order. */
  countries: string[];
}

/**
 * The sources the last run did not read, of the ones a reader is looking at.
 *
 * A source no dataset value cites is not reported: the reader is being told
 * about values, not about our plumbing. That drops the sentinels — an edition
 * index watched so a person notices a new PDF — and the learn links, which
 * back nothing and whose silence is already its own report.
 *
 * Oldest reading first, which is the order the sentence names them in and the
 * order the date in it comes from.
 */
export function unreadSources(dataset: Dataset, state: WatchState): UnreadSource[] {
  const cited = datasetSourceCountries(dataset);
  const out: UnreadSource[] = [];
  for (const entry of state.unread ?? []) {
    const countries = cited.get(entry.url);
    // Nothing a reader is looking at rests on it.
    if (!countries?.size) continue;
    const snapshot = state.entries[entry.id];
    // Never read at all: there is no day on which its values were read, so
    // this sentence cannot hold it. It is not dropped in silence — `npm run
    // check` prints it beside the ones that are reported, under
    // `never_read` — and what it would take to say it here is a date from the
    // dataset values themselves rather than from a snapshot that does not
    // exist (Standards review, 2026-09-15).
    if (!snapshot) continue;
    out.push({ id: entry.id, url: entry.url, last_read: snapshot.retrieved_at, countries: [...countries] });
  }
  return out.sort((a, b) => a.last_read.localeCompare(b.last_read) || a.id.localeCompare(b.id));
}

/**
 * Sources the run could not read that back values and have never been read —
 * the half of the answer the sentence cannot carry, counted so that nobody has
 * to find it by reading this function. `npm run check` prints it.
 */
export function unreadNeverRead(dataset: Dataset, state: WatchState): UnreadEntry[] {
  const cited = datasetSourceCountries(dataset);
  return (state.unread ?? []).filter((e) => cited.get(e.url)?.size && !state.entries[e.id]);
}

/** The countries named, staler first, each with how many of its sources went unread. */
function byCountry(sources: UnreadSource[]): { adjective: string; count: number }[] {
  const counts = new Map<string, number>();
  // `sources` arrives oldest-reading first, so insertion order is the order the
  // sentence wants: the country the date comes from is named first.
  for (const source of sources)
    for (const code of source.countries) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts].map(([code, count]) => {
    const adjective = countryAdjective(code);
    // CONTRIBUTING §8: there is no fallback to an id in something a person
    // reads. "A ES source has not answered" is not a sentence, and a fallback
    // is also what would stop the check on the vocabulary from ever biting.
    if (!adjective)
      throw new Error(
        `${code} has no adjective in the country vocabulary, so a sentence cannot name it — `
        + "add one beside the name in data/countries.json");
    return { adjective, count };
  });
}

/**
 * The exception clause the site prints on a day something went unread — empty
 * on every other day, which is the whole point: a page that always carries the
 * qualification says nothing, and a page that never does said "Every source is
 * re-read daily" on five days it had not.
 *
 * The human's wording, 2026-09-15:
 *
 * > Four Dutch sources did not answer on the last run; the values they back
 * > were read on 2026-09-07.
 *
 * It said "have not answered **since** 2026-09-07" until the walk that was
 * meant to approve it: built against a real run, the page named four IND
 * sources that had reported `unchanged` from the runner that same morning.
 * They answered. Their snapshots read 2026-09-07 because that is the day the
 * *reading* was taken, and an unchanged page keeps its date — the same
 * conflation this module exists because of, surviving in the copy after it had
 * been driven out of the derivation. `retrieved_at` is not "last read", and
 * nothing in this system knows a last-read date, so the sentence claims no
 * duration: it says which sources the last run did not reach, and the day the
 * values they back were read. Two facts the state actually holds.
 *
 * Numbers are spelled, because it is prose. A country contributing one source
 * takes the article rather than "one": "a Spanish and a Dutch source" is how
 * the sentence was written and how it reads. The noun agrees with the last
 * group named, the verb with the total — "a Spanish and two Dutch sources
 * have", "two Dutch and a Spanish source have".
 */
export function unreadSentence(sources: UnreadSource[]): string {
  const clause = unreadClause(sources);
  return clause ? `${clause.before}${clause.since}${clause.after}` : "";
}

/**
 * The same clause with its date held apart, for a page that marks dates up.
 *
 * Every other date on this site is wrapped in `<time datetime>` — two of them
 * in the paragraph this sentence joins — and a renderer cannot mark up a date
 * inside a string it has to escape whole. So the sentence hands over the day it
 * names, and the page decides what to wrap it in (Standards review,
 * 2026-09-15).
 */
export interface UnreadClause {
  /** Everything up to the date, ending in a space. */
  before: string;
  /** The oldest reading among the sources named — never the run's own day. */
  since: string;
  /** The rest, beginning at the semicolon. */
  after: string;
}

export function unreadClause(sources: UnreadSource[]): UnreadClause | undefined {
  if (!sources.length) return undefined;
  const groups = byCountry(sources);
  const phrases = groups.map((g, i) => {
    const last = i === groups.length - 1;
    if (g.count === 1) return `${article(g.adjective)} ${g.adjective}${last ? " source" : ""}`;
    return countedWords(g.count, `${g.adjective} source`, last ? `${g.adjective} sources` : g.adjective);
  });
  const subject = joinAnd(phrases);
  const many = sources.length > 1;
  return {
    before: `${subject.charAt(0).toUpperCase()}${subject.slice(1)} did not answer on the last run; the values ${
      many ? "they back were" : "it backs were"} read on `,
    since: sources[0]!.last_read,
    after: ".",
  };
}

/**
 * "a" or "an" before an adjective. English spells this off the sound, not the
 * letter — "a Ukrainian source", "an Italian source" — so `u` is left with the
 * consonants it is pronounced as here.
 */
function article(adjective: string): string {
  return /^[aeio]/i.test(adjective) ? "an" : "a";
}
