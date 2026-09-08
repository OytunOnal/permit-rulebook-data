import { countryClasses, countryPhrase } from "./countries.js";
import { DEFAULT_UNKNOWN_LABEL, UNKNOWN_BAND } from "./questions.js";
import {
  decidingCriteria, deriveBands, fieldOptions, forEachCriterion, formatEURPer, referencedFields,
} from "./engine.js";
import type {
  Criterion, CriterionResult, Dataset, FieldDef, FieldOption, Profile, Route, RouteResult, Unlock,
} from "./types.js";

/**
 * Why a route reads the way it does, in words a person would say.
 *
 * It lives here, beside the rules, for the reason `matchOptions` does: the
 * promise ("the reason column is prose, never engine output") has a permanent
 * check behind it, and the check has to survive the next control that renders
 * it. The page used to hold a field-id-to-label map; every field it had not
 * heard of fell through to the raw id, and 22 of 23 route cards told the user
 * "Not met: situation" (product-critique v0.7, blocker B3). Nothing here can
 * fall through to an id: the words come from the dataset's authored prose, and
 * `validateDataset` fails the build when a rule has none.
 */

const fieldCache = new WeakMap<Dataset, Map<string, FieldDef>>();
function fieldOf(dataset: Dataset, id: string): FieldDef | undefined {
  let index = fieldCache.get(dataset);
  if (!index) fieldCache.set(dataset, (index = new Map(dataset.fields.map((f) => [f.id, f]))));
  return index.get(id);
}

const join = (xs: string[], last: string): string =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${last} ${xs.at(-1)}`;
export const joinOr = (xs: string[]): string => join(xs, "or");
export const joinAnd = (xs: string[]): string => join(xs, "and");

/** How the fact is named in the answer ledger. */
export function shortLabelOf(dataset: Dataset, field: string): string {
  return fieldOf(dataset, field)?.short_label ?? field;
}

/** The fact as a noun phrase inside a sentence. */
export function subjectOf(dataset: Dataset, field: string): string {
  return fieldOf(dataset, field)?.subject ?? field;
}

/**
 * A value the rules name, as a noun phrase. Options carry `short` for exactly
 * this; a criterion written against a passport CLASS has no option to borrow
 * words from, so the class carries its own.
 */
function valuePhrase(dataset: Dataset, field: string, value: string): string {
  const option = fieldOptions(dataset, field).find((o) => o.value === value);
  if (option?.short) return option.short;
  if (option) return option.label;
  return countryClasses[value]?.short ?? countryClasses[value]?.label ?? value;
}

/** The answer as the person picked it — their words, quoted back. */
export function answerLabel(dataset: Dataset, field: string, value: string | undefined): string {
  if (value === undefined) return "no answer";
  const def = fieldOf(dataset, field);
  if (def?.type === "money_band")
    return deriveBands(dataset, field).find((b) => b.id === value)?.label
      // The answer that is not an amount, quoted back in the words the button
      // used — the same rule an enum's "I don't know" already follows.
      ?? (value === UNKNOWN_BAND ? def.unknown_label ?? DEFAULT_UNKNOWN_LABEL : value);
  return fieldOptions(dataset, field).find((o) => o.value === value)?.label ?? value;
}

/**
 * What a criterion asks for, as a noun phrase. `short_reason` overrides where
 * the option list reads badly in a sentence ("an age of 30 or older" beats
 * "30 to 35, 36 to 40 or over 40"); a disjunction expands into its paths, so
 * a route never has to name its own internal structure.
 */
export function criterionPhrase(dataset: Dataset, c: Criterion): string {
  if (c.short_reason) return c.short_reason;
  switch (c.op) {
    case "eq":
      return valuePhrase(dataset, c.field, c.value);
    case "in":
      return joinOr(c.values.map((v) => valuePhrase(dataset, c.field, v)));
    case "gte":
      return `at least ${formatEURPer(c.threshold.amount, fieldOf(dataset, c.field)?.period)}`;
    case "points":
      return `${c.required.value} points from the official table`;
    case "any":
      return joinOr(c.paths.map((p) => joinAnd(p.criteria.map((pc) => criterionPhrase(dataset, pc)))));
    default: {
      const _exhaustive: never = c;
      throw new Error(`unhandled criterion op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * A moot criterion, and what makes it moot: the route wants the "none of
 * these" answer (the Opportunity Card is for people with no offer yet) and the
 * person declared a real step, so they "failed" it by having MORE. "Not met:
 * situation" reads to an offer-holder as "lose your offer"; the honest line
 * names what they have. Exported because the page groups rows on the same
 * shape, and one definition cannot disagree with itself.
 */
export function mootWith(dataset: Dataset, cr: CriterionResult, profile: Profile): string | null {
  const c = cr.criterion;
  if (c.op !== "eq") return null;
  const required = fieldOptions(dataset, c.field).find((o) => o.value === c.value);
  const declared = fieldOptions(dataset, c.field).find((o) => o.value === profile[c.field]);
  return required?.is_fallback && declared?.short ? declared.short : null;
}

/**
 * A criterion that only asks WHERE a route applies. It reads the destination
 * and the country of the offer, both of which the person told us. Failing it
 * is not a shortfall — the route is simply somewhere else.
 */
export function isLocalization(c: Criterion): boolean {
  const fields = referencedFields(c);
  return fields.length > 0 && fields.every((f) => f === "destination" || f === "situation_country");
}

/** Where the person said they are headed, in their own words. */
export function declaredPlace(dataset: Dataset, profile: Profile): string {
  // One resolution, in one order, for every phrase that names a place: the
  // country the offer is in if the person placed it, otherwise the country they
  // are headed for if they have picked one. "Still deciding" is not a place.
  const field = profile["situation_country"] ? "situation_country" : "destination";
  const value = profile[field];
  if (!value || value === "all") return "";
  // The country's own prose form, from the vocabulary that holds the article:
  // a sentence says "the Netherlands", the button in the list says
  // "Netherlands". Both destination and situation_country are country codes, so
  // one lookup serves both; an option's `short` is a different sentence
  // ("Germany as your destination") and is deliberately not used here.
  return countryPhrase(value.toUpperCase()) ??
    fieldOptions(dataset, field).find((o) => o.value === value)?.label ?? "";
}

/** Unknowns the person can still act on: on a hard-failed route nothing they
 * find out can change the verdict, so none of them is open. */
export function liveUnknowns(r: RouteResult, profile: Profile): string[] {
  if (r.hard_fail) return [];
  return r.unknown_fields.filter((f) => profile[f] !== undefined);
}

/** Once a route is in the wrong country, nothing else about it is news. */
export function isPlacedElsewhere(r: RouteResult, profile: Profile): boolean {
  return r.criteria.some((c) => c.outcome === "fail" && isLocalization(c.criterion)) &&
    liveUnknowns(r, profile).length === 0;
}

export interface ReasonRow {
  /** needs: a shortfall · moot: already covered · where: another country ·
   * unknown: an answer of "I don't know" that still binds. */
  kind: "needs" | "moot" | "where" | "unknown";
  text: string;
}

export interface Reason {
  /** The one line the card shows — always a sentence. */
  line: string;
  /** The same reason unfolded, one row per criterion. */
  rows: ReasonRow[];
  /** The phrases the line was built from, for callers that lay them out
   * themselves — and for the test that no field NAME ever lands in one. */
  parts: { needs: string[]; unknown: string[]; moot: string[] };
}

const countryName = (dataset: Dataset, code: string): string =>
  dataset.countries.find((c) => c.code === code)?.name ?? code;

export function reasonFor(dataset: Dataset, r: RouteResult, profile: Profile): Reason {
  const rows: ReasonRow[] = [];
  const needs: string[] = [];
  const moot: string[] = [];
  const unknownFields = liveUnknowns(r, profile);
  const unknownSubjects = unknownFields.map((f) => subjectOf(dataset, f));
  // Quoted as the person actually answered it: the results used to report an
  // "I don't know" for a button that said "I don't know yet" (product-critique
  // v0.7, P4). The dataset now says one thing; this reads it rather than
  // assuming it.
  const unknownAnswer = (field: string) => answerLabel(dataset, field, profile[field]);

  for (const cr of r.criteria) {
    if (cr.outcome !== "fail") continue;
    const already = mootWith(dataset, cr, profile);
    if (already) {
      moot.push(already);
      rows.push({ kind: "moot", text: `Not needed — you already have ${already}.` });
      continue;
    }
    if (isLocalization(cr.criterion)) {
      const place = declaredPlace(dataset, profile);
      rows.push({
        kind: "where",
        text: `This route is ${countryName(dataset, r.country)}${place ? `, and you told us ${place}` : ""}.`,
      });
      continue;
    }
    const asks = criterionPhrase(dataset, cr.criterion);
    needs.push(asks);
    const c = cr.criterion;
    rows.push({
      kind: "needs",
      text: "field" in c
        ? `Needs ${asks} — you declared ${answerLabel(dataset, c.field, profile[c.field])}.`
        : `Needs ${asks}.`,
    });
  }

  for (const field of unknownFields)
    rows.push({
      kind: "unknown",
      text: `You answered “${unknownAnswer(field)}” about ${subjectOf(dataset, field)}.`,
    });

  const parts = { needs, unknown: unknownSubjects, moot };

  if (r.status === "met")
    return { line: r.route.summary ?? "Every published condition we check appears met by your declaration.", rows, parts };

  if (r.status === "near")
    return {
      line: r.gap_points !== undefined
        ? "The points total is within reach — the ladder below shows your score."
        : shortfallLine(dataset, r, profile),
      rows, parts,
    };

  if (isPlacedElsewhere(r, profile)) {
    const place = declaredPlace(dataset, profile);
    const country = countryName(dataset, r.country);
    return { line: place ? `A ${country} route — you told us ${place}.` : `A ${country} route.`, rows, parts };
  }

  const sentences: string[] = [];
  if (moot.length) sentences.push(`Not needed with ${joinAnd(moot)}.`);
  // A requirement that is itself a choice already spends its "or"; joining the
  // list with a bare "and" then leaves the reader to guess where one
  // requirement ends. The semicolon says it.
  if (needs.length)
    sentences.push(`Needs ${
      needs.length > 1 && needs.some((n) => / or /.test(n)) ? needs.join("; and ") : joinAnd(needs)
    }.`);
  if (unknownSubjects.length)
    sentences.push(
      `You answered “${unknownAnswer(unknownFields[0])}” about ${joinAnd(unknownSubjects)} — an open gap, not a no.`,
    );
  return {
    line: sentences.length ? sentences.join(" ") : "Nothing on this route is decided by what you have told us so far.",
    rows, parts,
  };
}

type Gte = Extract<Criterion, { op: "gte" }>;

/** How far the declared band sits below one threshold, worst case. */
function gapAgainst(dataset: Dataset, c: Gte, profile: Profile): number | undefined {
  const band = deriveBands(dataset, c.field).find((b) => b.id === profile[c.field]);
  if (!band || band.max === undefined || band.max > c.threshold.amount) return undefined;
  return c.threshold.amount - (band.min ?? 0);
}

/** Every gte criterion in a route, at any depth. */
function gteCriteriaOf(route: Route): Gte[] {
  const out: Gte[] = [];
  forEachCriterion(route.criteria, (c) => { if (c.op === "gte") out.push(c); });
  return out;
}

/**
 * The criterion a near result was measured against — the rule the reader is
 * actually short of.
 *
 * It lives beside the sentence that names it because the two must never
 * disagree: the card draws its rail and its "short by" banner on this
 * criterion, and the one-line explanation used to say "salary" whatever the
 * criterion was. A reader with a good salary and too little in the bank was
 * told to ask for a raise (isolated v1-gate critique, 2026-09-08).
 *
 * The path that was met, or — where none was — the nearest reachable one, which
 * is the path the engine measured the gap to. Where nothing has decided a
 * choice of paths yet, it names a threshold the person can at least locate
 * their band against.
 */
export function gapCriterionOf(dataset: Dataset, r: RouteResult, profile: Profile): Gte | undefined {
  const decided = decidingCriteria(r.criteria)
    .flatMap((cr) => (cr.criterion.op === "gte" ? [cr.criterion] : []))
    .filter((c) => profile[c.field] !== undefined);
  const gapped = r.gap_max === undefined
    ? undefined
    : decided.find((c) => Math.abs((gapAgainst(dataset, c, profile) ?? NaN) - r.gap_max!) < 0.005);
  return gapped ?? decided[0] ?? gteCriteriaOf(r.route).find((c) => profile[c.field] !== undefined);
}

/**
 * What a within-reach result is short of, in the rule's own words and with the
 * distance the card shows beside it.
 *
 * "Up to", because a band is a range: the reader declared somewhere inside it,
 * and the worst case is the only honest number.
 */
function shortfallLine(dataset: Dataset, r: RouteResult, profile: Profile): string {
  const measured = gapCriterionOf(dataset, r, profile);
  if (!measured || r.gap_max === undefined)
    return "One rule on this route is within reach — the card below shows which.";
  const rule = shortLabelOf(dataset, measured.field).toLowerCase();
  const amount = formatEURPer(Math.round(r.gap_max), fieldOf(dataset, measured.field)?.period);
  const named = measured.threshold_label ? ` — ${measured.threshold_label}` : "";
  return `Up to ${amount} short of the ${rule} this route asks for${named}.`;
}

/**
 * The step an unlock row offers, in the person's own words — and, where the
 * answer is one a reader can mistake for the one they already have, what the
 * step actually is.
 *
 * "With a job offer → Highly skilled migrant would be met" was read by a person
 * whose employer was moving them to its Dutch branch as something they already
 * had (human walk, 2026-09-08). They do have an offer; they do not have this
 * one. What the step actually is comes from `optionMeans` below and is shown
 * beside this title rather than inside it, so the step stays the short phrase a
 * row is scanned by and the distinction reads as the sentence it is.
 */
export function unlockTitleOf(dataset: Dataset, u: Unlock, profile: Profile = {}): string {
  const def = fieldOf(dataset, u.field);
  let title = u.option.short ?? u.option.label;
  if (def?.type === "money_band") title += ` — ${shortLabelOf(dataset, u.field).toLowerCase()}`;
  if (u.qualifier) {
    // A qualifier's `short` is a subject, written to follow "Needs" ("your
    // offer, transfer or agreement in Germany"). A heading wants the place
    // itself, so it comes from the same resolution the row's sentence uses.
    const place = declaredPlace(dataset, unlockProfile(u, profile));
    if (u.qualifier.field === "situation_country") { if (place) title += ` in ${place}`; }
    else title += ` · ${u.qualifier.option.label}`;
  }
  return title;
}

/**
 * The reader's profile as it would stand with this step taken — the row's own
 * counterfactual. Every phrase in a leverage row reads off this one profile, so
 * a forked row says the country it forked on and the sentence under it agrees.
 */
export function unlockProfile(u: Unlock, profile: Profile = {}): Profile {
  const taken: Profile = { ...profile, [u.field]: u.option.value };
  if (u.qualifier) taken[u.qualifier.field] = u.qualifier.option.value;
  return taken;
}

/** What the step this row offers actually is, in the row's own place. */
export function unlockMeansOf(dataset: Dataset, u: Unlock, profile: Profile = {}): string {
  return optionMeans(u.option, dataset, unlockProfile(u, profile));
}

/**
 * What an option means here, with `{place}` filled in from what the reader
 * declared.
 *
 * The preposition travels with the place, not with the sentence: where nothing
 * has been declared the token becomes "there" — the word the option labels
 * already use — and "an employer in there" is not a sentence anyone would say.
 */
export function optionMeans(
  option: FieldOption, dataset: Dataset, profile: Profile = {},
): string {
  if (!option.means) return "";
  const place = declaredPlace(dataset, profile);
  return option.means.split("{place}").join(place ? `in ${place}` : "there");
}
