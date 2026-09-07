import { countryOptions } from "./countries.js";
import type {
  Band, Criterion, CriterionResult, Dataset, DatasetMeta, DecidedPath, FieldDef, FieldOption, Notice,
  PointsBreakdown, PointsItem, Profile, Route, RouteReading, RouteResult, RouteStatement, RouteStatus,
} from "./types.js";

export function formatEUR(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return "€" + amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Money with the period it is stated per ("€1,585/month") — a bare amount
 * reads as annual to one user and monthly to the next (critique #7). */
export function formatEURPer(amount: number, period?: "month" | "year"): string {
  return period ? `${formatEUR(amount)}/${period}` : formatEUR(amount);
}

/**
 * The notices that apply to this profile. A notice states what no route can
 * ("you need no permit at all"); it is stated only on an answer the person
 * actually gave — an unanswered field never matches.
 */
export function notices(dataset: Dataset, profile: Profile): Notice[] {
  return (dataset.notices ?? []).filter((n) => {
    const answer = profile[n.when.field];
    if (answer === undefined) return false;
    // The SAME predicate the criteria use (see `satisfies`): a country can
    // never satisfy a route through its class but miss the notice written
    // against that class.
    const wanted = n.when.op === "eq" ? (n.when.value === undefined ? [] : [n.when.value]) : (n.when.values ?? []);
    return satisfies(dataset, n.when.field, answer, wanted);
  });
}

/** Every threshold referenced by gte-criteria on this field, ascending, deduplicated. */
export function thresholdsForField(dataset: Dataset, field: string): number[] {
  const amounts = new Set<number>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        if (c.op === "gte" && c.field === field) amounts.add(c.threshold.amount);
      });
  return [...amounts].sort((a, b) => a - b);
}

// Bands are pure functions of the dataset; memoized per dataset object because the
// hot paths (evaluate, question ordering, property tests) re-derive them constantly.
const bandCache = new WeakMap<Dataset, Map<string, Band[]>>();

/**
 * Band boundaries ARE the thresholds themselves: n thresholds produce n+1 bands.
 * A band passes a threshold iff its inclusive lower bound reaches it, so an
 * answer never straddles a decision boundary.
 */
export function deriveBands(dataset: Dataset, field: string): Band[] {
  let perField = bandCache.get(dataset);
  if (!perField) bandCache.set(dataset, (perField = new Map()));
  const cached = perField.get(field);
  if (cached) return cached;
  const ts = thresholdsForField(dataset, field);
  const bands: Band[] = [];
  for (let i = 0; i <= ts.length; i++) {
    const min = i === 0 ? undefined : ts[i - 1];
    const max = i === ts.length ? undefined : ts[i];
    let label: string;
    if (min === undefined && max !== undefined) label = `under ${formatEUR(max)}`;
    else if (min !== undefined && max !== undefined) label = `${formatEUR(min)} – ${formatEUR(max)}`;
    else if (min !== undefined) label = `${formatEUR(min)} or more`;
    else label = "any amount";
    bands.push({ id: `band_${i}`, min, max, label });
  }
  // Frozen: the cached array is shared by every caller, and dataset objects
  // are treated as immutable — clone (structuredClone) before mutating one,
  // or the cache serves stale edges with no error.
  for (const b of bands) Object.freeze(b);
  Object.freeze(bands);
  perField.set(field, bands);
  return bands;
}

/**
 * Field and option lookups, indexed once per dataset. Both are on every hot
 * path (evaluate, question ordering, property suites) and one of them is now a
 * 249-entry country list — a linear scan per criterion is a different program
 * at that size. Dataset objects are treated as immutable; clone before
 * mutating one, or the index serves stale options with no error.
 */
interface FieldIndex {
  def: FieldDef;
  options: FieldOption[];
  byValue: Map<string, FieldOption>;
}
const fieldCache = new WeakMap<Dataset, Map<string, FieldIndex>>();

function fieldIndex(dataset: Dataset, id: string): FieldIndex | undefined {
  let perDataset = fieldCache.get(dataset);
  if (!perDataset) {
    perDataset = new Map();
    for (const def of dataset.fields) {
      // `options_from` keeps the vocabulary in its own file; the engine expands
      // it here so every consumer sees one option list, whatever its source.
      const options = def.options ?? (def.options_from === "countries" ? countryOptions() : []);
      perDataset.set(def.id, { def, options, byValue: new Map(options.map((o) => [o.value, o])) });
    }
    fieldCache.set(dataset, perDataset);
  }
  return perDataset.get(id);
}

function fieldDef(dataset: Dataset, id: string): FieldDef | undefined {
  return fieldIndex(dataset, id)?.def;
}

/** Every option of an enum field, with `options_from` lists already expanded. */
export function fieldOptions(dataset: Dataset, id: string): FieldOption[] {
  return fieldIndex(dataset, id)?.options ?? [];
}

/**
 * The one predicate that decides whether an answer meets a wanted value —
 * used by `eq`, by `in`, by notice matching and by `pointsFor`. An answer
 * satisfies a value when it IS that value, or when its option's `implies` list
 * carries it ("TR" implies "third_country"; "3+ years within the last 7"
 * implies the two-year band it clears).
 */
function satisfies(dataset: Dataset, field: string, answer: string, wanted: string[]): boolean {
  if (wanted.includes(answer)) return true;
  const implied = fieldIndex(dataset, field)?.byValue.get(answer)?.implies;
  return implied !== undefined && wanted.some((v) => implied.includes(v));
}

/**
 * What one answer scores on one points item — the ONE place a points value is
 * read, so the scorer and the equivalence fingerprint cannot disagree.
 *
 * The answer scores the BEST of the rows it satisfies, never their sum: an
 * `implies` list says the same person also clears a lower rung, and a ladder
 * pays for the highest rung reached, not for every rung below it.
 *
 * The old comment on `satisfies` said points tables deliberately key on the
 * raw answer, "and if a points item ever reads a class-bearing field, decide
 * the semantics on purpose rather than inheriting them". s5f made one: the
 * `experience` ladder gained `y3in7`, which implies `y2in5`, and the
 * Chancenkarte scores `experience`. Keying on the raw answer paid the honest
 * three-year answerer 0 where the two-year answerer got 2 (review 2026-09-07).
 */
function pointsFor(dataset: Dataset, item: PointsItem, answer: string): number {
  let best = item.points[answer] ?? 0;
  for (const [value, pts] of Object.entries(item.points))
    if (pts > best && satisfies(dataset, item.field, answer, [value])) best = pts;
  return best;
}

/** All field ids a criterion reads (recursing through disjunctions). */
export function referencedFields(c: Criterion): string[] {
  if (c.op === "points") return c.table.items.map((i) => i.field);
  if (c.op === "any") return c.paths.flatMap((p) => p.criteria.flatMap(referencedFields));
  return [c.field];
}

function isUnknownAnswer(dataset: Dataset, field: string, answer: string | undefined): boolean {
  if (answer === undefined) return true;
  return fieldIndex(dataset, field)?.byValue.get(answer)?.is_unknown === true;
}

/**
 * Which of two fully-gapped disjunction paths is the shorter way through.
 * Euros and points are not comparable, so a path that closes on one currency
 * beats one that needs both; within a currency the smaller gap wins. Ties keep
 * the earlier path, so the dataset's own order stays the tie-break.
 */
function isNearerThan(a: CriterionResult, b: CriterionResult): boolean {
  const currencies = (r: CriterionResult) => (r.gap_max !== undefined ? 1 : 0) + (r.gap_points !== undefined ? 1 : 0);
  if (currencies(a) !== currencies(b)) return currencies(a) < currencies(b);
  if (a.gap_max !== undefined && b.gap_max !== undefined && a.gap_max !== b.gap_max) return a.gap_max < b.gap_max;
  if (a.gap_points !== undefined && b.gap_points !== undefined && a.gap_points !== b.gap_points)
    return a.gap_points < b.gap_points;
  return false;
}

/**
 * Whether this criterion result leaves its route or path still reachable: it
 * did not fail, or it failed only by a bounded gap the person can still close.
 *
 * The one definition. It had drifted into four spellings of the same
 * conjunction — the disjunction's "every failure is bounded", the status
 * rule's `allFailsGapped`, the question-picker's "this path can still be
 * MEASURED", and `isHardFail`'s two early returns. They composed only by
 * coincidence, and the next edit to any one of them would have moved a
 * verdict without moving the others (review 2026-09-07).
 */
function stillReachable(r: CriterionResult): boolean {
  return r.outcome !== "fail" || r.gap_max !== undefined || r.gap_points !== undefined;
}

/** Which path decided a disjunction, in the shape a consumer can walk. */
function decidedPath(c: Extract<Criterion, { op: "any" }>, index: number, criteria: CriterionResult[]): DecidedPath {
  const label = c.paths[index].label;
  return label === undefined ? { index, criteria } : { index, label, criteria };
}

function evalCriterion(dataset: Dataset, c: Criterion, profile: Profile): CriterionResult {
  if (c.op === "any") {
    const pathResults = c.paths.map((p) => p.criteria.map((pc) => evalCriterion(dataset, pc, profile)));
    // A path passes when all its criteria pass; the disjunction passes with it.
    // WHICH path passed is the story the card tells — a route met through the
    // reduced salary must name the reduced threshold, not the first one written.
    const passedIndex = pathResults.findIndex((rs) => rs.every((r) => r.outcome === "pass"));
    if (passedIndex >= 0) {
      const passed = pathResults[passedIndex];
      const points = passed.find((r) => r.points)?.points;
      const result: CriterionResult = { criterion: c, outcome: "pass", path: decidedPath(c, passedIndex, passed) };
      if (points) result.points = points;
      return result;
    }
    if (pathResults.every((rs) => rs.some((r) => r.outcome === "fail"))) {
      // Every path failed — but if a path failed only by bounded gaps (salary
      // just below, points just short), that near-miss is the story the gap
      // analysis must tell. With two salary paths on one route (full criterion
      // OR reduced criterion plus the fact that earns it) the honest distance
      // is the NEAREST reachable path, not whichever was written first: a
      // graduate under €3,122 is €3,122 away, never €4,357 away. Paths the
      // profile cannot reach (a flat "no" on the qualifying fact) carry an
      // ungapped fail and are excluded here, so no gap is ever measured
      // against a threshold the person cannot get to.
      let best: CriterionResult | undefined;
      // A path whose failures are all bounded but whose own answers are still
      // open has not had its say: answering them turns "nothing decided" into a
      // measured shortfall. Reporting an ungapped fail there retires the route
      // AND its remaining questions, so the answer that would have made it a
      // near miss is never asked — a €0 transfer to the Netherlands read as a
      // dead ICT route because nobody asked the applicant's age (found by the
      // completed-interview property, 2026-09-07).
      let openBounded = false;
      for (const [index, rs] of pathResults.entries()) {
        const fails = rs.filter((r) => r.outcome === "fail");
        const undecided = rs.filter((r) => r.outcome === "unknown");
        const bounded = fails.every(stillReachable);
        if (undecided.length > 0) {
          if (bounded) openBounded = true;
          continue;
        }
        if (!bounded) continue;
        const result: CriterionResult = { criterion: c, outcome: "fail", path: decidedPath(c, index, rs) };
        const gapsMoney = fails.map((f) => f.gap_max).filter((g): g is number => g !== undefined);
        const gapsPoints = fails.map((f) => f.gap_points).filter((g): g is number => g !== undefined);
        if (gapsMoney.length) result.gap_max = Math.max(...gapsMoney);
        if (gapsPoints.length) result.gap_points = Math.max(...gapsPoints);
        const pts = rs.find((r) => r.points)?.points;
        if (pts) result.points = pts;
        if (best === undefined || isNearerThan(result, best)) best = result;
      }
      if (best) return best;
      return { criterion: c, outcome: openBounded ? "unknown" : "fail" };
    }
    // Undecided: surface points progress from a still-open points path, if any.
    const open = pathResults.find((rs) => !rs.some((r) => r.outcome === "fail") && rs.some((r) => r.points));
    const points = open?.find((r) => r.points)?.points;
    return points ? { criterion: c, outcome: "unknown", points } : { criterion: c, outcome: "unknown" };
  }

  if (c.op === "points") {
    let scored = 0;
    let unanswered = 0;
    const items: PointsBreakdown["items"] = [];
    for (const item of c.table.items) {
      const answer = profile[item.field];
      if (isUnknownAnswer(dataset, item.field, answer)) {
        unanswered++;
      } else {
        const pts = pointsFor(dataset, item, answer as string);
        scored += pts;
        if (pts > 0) items.push({ field: item.field, points: pts });
      }
    }
    const points: PointsBreakdown = { scored, required: c.required.value, items };
    if (scored >= c.required.value) return { criterion: c, outcome: "pass", points };
    // Deliberately no early-unreachable death: the full score IS the gap
    // analysis ("4 of 6"), and the ladder is short. Decide only when complete.
    if (unanswered > 0) return { criterion: c, outcome: "unknown", points };
    return { criterion: c, outcome: "fail", points, gap_points: c.required.value - scored };
  }

  const answer = profile[c.field];
  if (answer === undefined) return { criterion: c, outcome: "unknown" };

  if (c.op === "eq") {
    if (isUnknownAnswer(dataset, c.field, answer)) return { criterion: c, outcome: "unknown" };
    return { criterion: c, outcome: satisfies(dataset, c.field, answer, [c.value]) ? "pass" : "fail" };
  }

  if (c.op === "in") {
    if (isUnknownAnswer(dataset, c.field, answer)) return { criterion: c, outcome: "unknown" };
    return { criterion: c, outcome: satisfies(dataset, c.field, answer, c.values) ? "pass" : "fail" };
  }

  // gte over a money_band answer
  const bands = deriveBands(dataset, c.field);
  const band = bands.find((b) => b.id === answer);
  if (!band) return { criterion: c, outcome: "unknown" };
  if (band.min !== undefined && band.min >= c.threshold.amount)
    return { criterion: c, outcome: "pass" };
  const result: CriterionResult = { criterion: c, outcome: "fail" };
  // Any declared band with a finite ceiling below the threshold is a bounded,
  // honest gap ("up to X"). Adjacency must not matter: band edges are pooled
  // across all countries, so "one band away" would silently change meaning
  // whenever an unrelated country's threshold lands nearby (review catch).
  if (band.max !== undefined && band.max <= c.threshold.amount)
    result.gap_max = c.threshold.amount - (band.min ?? 0);
  return result;
}

function routeStatus(criteria: CriterionResult[]): RouteStatus {
  const fails = criteria.filter((r) => r.outcome === "fail");
  const unknowns = criteria.filter((r) => r.outcome === "unknown");
  if (fails.length === 0 && unknowns.length === 0) return "met";
  const allFailsGapped = fails.every(stillReachable);
  if (fails.length > 0 && allFailsGapped && unknowns.length === 0) return "near";
  return "hold";
}

/** A failed criterion whose referenced fields are ALL improvable (language,
 * funds, experience…) is a shortfall the person can close — gap story, not
 * a death sentence. */
function failsOnlyImprovables(dataset: Dataset, c: Criterion): boolean {
  const fields = referencedFields(c);
  return fields.length > 0 &&
    fields.every((f) => dataset.fields.find((d) => d.id === f)?.kind === "improvable");
}

/**
 * Hard fail = failed with no bounded gap AND not purely on improvable fields.
 * Bounded shortfalls (adjacent money band, points a few short) and improvable
 * shortfalls (no German yet) keep the interview going so the route can finish
 * with a complete, actionable picture. Fixed-attribute and path fails
 * (citizenship, qualification, situation) end it for real.
 */
function isHardFail(dataset: Dataset, r: CriterionResult): boolean {
  if (stillReachable(r)) return false;
  return !failsOnlyImprovables(dataset, r.criterion);
}

function hasHardFail(dataset: Dataset, route: Route, profile: Profile): boolean {
  return route.criteria.some((c) => isHardFail(dataset, evalCriterion(dataset, c, profile)));
}

/**
 * A route is alive while no answered criterion has HARD-failed.
 * "unknown" answers and bounded gaps keep a route alive — an open gap is not a no.
 */
export function isRouteAlive(dataset: Dataset, route: Route, profile: Profile): boolean {
  return !hasHardFail(dataset, route, profile);
}

/** Unanswered fields that can still flip THIS criterion's outcome. */
function undecidedFieldsOf(dataset: Dataset, c: Criterion, profile: Profile): string[] {
  const result = evalCriterion(dataset, c, profile);
  if (result.outcome !== "unknown") return [];
  if (c.op === "points")
    return c.table.items.map((i) => i.field).filter((f) => profile[f] === undefined);
  if (c.op === "any")
    // Paths that can still be satisfied — or still be MEASURED. A path failing
    // on an ungapped criterion is out of reach and its questions are noise; one
    // failing only by a bounded gap still turns the route into a near miss, so
    // the answers it is waiting on are worth asking for.
    return c.paths
      .filter((p) => p.criteria.every((pc) => stillReachable(evalCriterion(dataset, pc, profile))))
      .flatMap((p) => p.criteria.flatMap((pc) => undecidedFieldsOf(dataset, pc, profile)));
  return profile[c.field] === undefined ? [c.field] : [];
}

/**
 * Fields that can still change some live route's outcome. Sharper than "fields
 * of live routes": a points criterion already passed, a decided criterion, or
 * a failed disjunction path makes its remaining fields uninformative — asking
 * them is noise.
 */
export function informativeFields(dataset: Dataset, profile: Profile): Set<string> {
  const fields = new Set<string>();
  for (const country of dataset.countries) {
    for (const route of country.routes) {
      if (hasHardFail(dataset, route, profile)) continue; // dead route
      for (const c of route.criteria)
        for (const f of undecidedFieldsOf(dataset, c, profile)) fields.add(f);
    }
  }
  return fields;
}

/** One representative answer plus the number of options it stands for. */
export interface OptionClass {
  value: string;
  weight: number;
}

const equivalenceCache = new WeakMap<Dataset, Map<string, OptionClass[]>>();

/**
 * How an answer looks to every criterion that reads this field: whether it
 * counts as unknown, whether it satisfies each `eq`/`in` test, and what it
 * scores on each points item. Two answers with the same fingerprint are
 * indistinguishable to the rules — every route's outcome, for every profile,
 * is the same under either. (`gte` never reads an enum field, and enum
 * criteria never produce bounded gaps, so outcomes are the whole story.)
 */
function equivalenceKey(dataset: Dataset, field: string, value: string): string {
  if (fieldDef(dataset, field)?.type !== "enum") return value; // bands compare numerically
  const parts: string[] = [isUnknownAnswer(dataset, field, value) ? "?" : "."];
  for (const country of dataset.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        if (c.op === "eq" && c.field === field) parts.push(satisfies(dataset, field, value, [c.value]) ? "1" : "0");
        else if (c.op === "in" && c.field === field) parts.push(satisfies(dataset, field, value, c.values) ? "1" : "0");
        else if (c.op === "points")
          for (const item of c.table.items)
            if (item.field === field) parts.push(`p${pointsFor(dataset, item, value)}`);
      });
  // Notices are part of what an answer decides, so two answers are only
  // interchangeable when they draw the same notices too — otherwise a consumer
  // deduping a dropdown by these classes would drop the Ankara-agreement
  // notice, which fires for exactly one country (review).
  for (const n of dataset.notices ?? [])
    if (n.when.field === field)
      parts.push(satisfies(dataset, field, value, n.when.value !== undefined ? [n.when.value] : (n.when.values ?? [])) ? `n${n.id}` : "-");
  return parts.join("|");
}

/**
 * The field's options collapsed into classes the rules cannot tell apart, in
 * option order, each carrying how many options it represents. Question
 * ordering scores a candidate by averaging the live-route count over its
 * options; with a country list that was ~249 dataset evaluations per candidate,
 * on every question of every interview. Scoring one representative per class
 * and weighting by class size yields the identical average — and therefore the
 * identical ordering — at the old cost.
 */
export function optionEquivalenceClasses(dataset: Dataset, field: string, values: string[]): OptionClass[] {
  let perField = equivalenceCache.get(dataset);
  if (!perField) equivalenceCache.set(dataset, (perField = new Map()));
  // Keyed on the value list too: a caller may ask about a subset, and keying on
  // the field alone handed back the full-list weights for a two-value request
  // (review).
  const cacheKey = `${field} ${values.join(",")}`;
  const cached = perField.get(cacheKey);
  if (cached) return cached;
  const byKey = new Map<string, OptionClass>();
  for (const value of values) {
    const key = equivalenceKey(dataset, field, value);
    const seen = byKey.get(key);
    if (seen) seen.weight++;
    else byKey.set(key, { value, weight: 1 });
  }
  const classes = [...byKey.values()];
  perField.set(cacheKey, classes);
  return classes;
}

/** Fold for search: lower-case, then drop combining marks so "turk" finds
 * "Türkiye". Letters that carry no mark (ø, ł, đ) do not decompose — those are
 * covered by aliases, not by folding. */
export function foldForSearch(s: string): string {
  // Punctuation is not how anyone remembers a country. The labels carry a
  // typographic apostrophe (Côte d’Ivoire), hyphens (Guinea-Bissau,
  // Timor-Leste) and spacing people type differently or not at all, so
  // everything that is not a letter or a digit comes out before comparing.
  // Before this, “cote d'ivoire” typed with a straight apostrophe matched
  // nothing at all.
  return s.toLocaleLowerCase("en").normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * The options a typed needle matches — label or alias, never the value.
 * Lives here rather than in the page because "can this person find their own
 * country" is a promise with a permanent check behind it: a Turkish user
 * typing "turkey" was told to check their spelling (product-critique
 * 2026-09-04), and the fix has to survive the next control that renders it.
 */
export function matchOptions(options: FieldOption[], needle: string): FieldOption[] {
  const n = foldForSearch(needle.trim());
  if (!n) return options;
  // Each name is folded on its own: joining them first would let a needle
  // match across the seam between a label and an alias.
  const namesOf = (o: FieldOption) => [o.label, ...(o.aliases ?? [])].map(foldForSearch);
  const matched = options.filter((o) => namesOf(o).some((name) => name.includes(n)));
  // The country whose name IS what was typed leads. Typing "sudan" listed
  // South Sudan first, and the first row is what a habitual Enter takes:
  // a whole eligibility record computed for the wrong nationality, with no
  // word said about it (product-critique v0.7, B1). Sorting is stable, so
  // everything else keeps the alphabetical order it already had — the
  // highlighted row must not move under the user between keystrokes.
  const exact = (o: FieldOption) => (namesOf(o).includes(n) ? 0 : 1);
  return matched.sort((a, b) => exact(a) - exact(b));
}

export function evaluate(dataset: Dataset, profile: Profile): RouteResult[] {
  const results: RouteResult[] = [];
  for (const country of dataset.countries) {
    for (const route of country.routes) {
      const criteria = route.criteria.map((c) => evalCriterion(dataset, c, profile));
      const status = routeStatus(criteria);
      const gaps = criteria.filter((c) => c.gap_max !== undefined).map((c) => c.gap_max as number);
      const pointsResult = criteria.find((c) => c.points !== undefined);
      const pointsGaps = criteria.filter((c) => c.gap_points !== undefined).map((c) => c.gap_points as number);
      const unknown = new Set<string>();
      for (const cr of criteria)
        if (cr.outcome === "unknown")
          for (const f of referencedFields(cr.criterion))
            if (isUnknownAnswer(dataset, f, profile[f])) unknown.add(f);
      results.push({
        route,
        country: country.code,
        status,
        // Same predicate that retires a route mid-interview: the UI needs it to
        // tell "an unknown still binds here" from "nothing can save this".
        hard_fail: criteria.some((cr) => isHardFail(dataset, cr)),
        criteria,
        gap_max: gaps.length ? Math.max(...gaps) : undefined,
        gap_points: pointsGaps.length ? Math.max(...pointsGaps) : undefined,
        points: pointsResult?.points,
        unknown_fields: [...unknown],
      });
    }
  }
  const order: RouteStatus[] = ["met", "near", "hold"];
  return results.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

/**
 * Counterfactual leverage: for every answered PATH field, re-evaluate the
 * profile under each alternative (non-fallback, non-unknown) option and
 * report the routes that would turn met/near. "How close is an offer" is
 * unknowable; "what an offer unlocks" is pure arithmetic.
 */
export function unlocks(dataset: Dataset, profile: Profile): import("./types.js").Unlock[] {
  const out: import("./types.js").Unlock[] = [];
  const baseline = new Map(evaluate(dataset, profile).map((r) => [r.route.id, r.status]));
  for (const def of dataset.fields) {
    if (def.kind !== "path" && def.kind !== "improvable") continue;
    const current = profile[def.id];
    if (current === undefined) continue;
    const candidates =
      def.type === "money_band"
        ? deriveBands(dataset, def.id).map((b) => ({ value: b.id, label: b.label }))
        : fieldOptions(dataset, def.id);
    for (const opt of candidates) {
      if (opt.value === current || ("is_unknown" in opt && opt.is_unknown) || ("is_fallback" in opt && opt.is_fallback)) continue;
      const hypo: Profile = { ...profile, [def.id]: opt.value };
      const hypoResults = evaluate(dataset, hypo);
      const opened = hypoResults.filter(
        (r) => (r.status === "met" || r.status === "near") && baseline.get(r.route.id) === "hold",
      );
      if (opened.length) out.push({ field: def.id, option: opt, routes: opened });

      // Qualifier fork: some steps only prove out together with one unanswered
      // attribute — "a job offer" needs "…in which country?" when the user asked
      // for all destinations and localization was never asked. For each attribute
      // enum still blocking a route under the counterfactual, fork per option and
      // keep only fully-proven openings. Single-step honesty holds: the row
      // states both assumptions, and both are one decision for the user.
      if (def.kind !== "path") continue; // qualifiers belong to steps, not skills
      const directIds = new Set(opened.map((r) => r.route.id));
      const blockers = new Set<string>();
      for (const r of hypoResults) {
        if (baseline.get(r.route.id) !== "hold" || directIds.has(r.route.id)) continue;
        for (const cr of r.criteria)
          if (cr.outcome === "unknown")
            for (const f of referencedFields(cr.criterion))
              if (hypo[f] === undefined) blockers.add(f);
      }
      for (const qf of blockers) {
        const qdef = fieldDef(dataset, qf);
        // Only fields the dataset explicitly marks as qualifiers: the answer
        // must be part of the same real-world decision as the step itself
        // ("an offer — in which country?"). Admitting any attribute produced
        // nonsense rows like "a job offer · under 30" (review catch).
        if (!qdef?.is_qualifier) continue;
        for (const qopt of fieldOptions(dataset, qf)) {
          if (qopt.is_unknown || qopt.is_fallback) continue;
          const forked = evaluate(dataset, { ...hypo, [qf]: qopt.value }).filter(
            (r) =>
              (r.status === "met" || r.status === "near") &&
              baseline.get(r.route.id) === "hold" &&
              !directIds.has(r.route.id),
          );
          if (forked.length)
            out.push({ field: def.id, option: opt, qualifier: { field: qf, option: qopt }, routes: forked });
        }
      }
    }
  }
  return out;
}

export interface ProvenanceEntry {
  label?: string;
  value: { quote: string; source_url: string; retrieved_at: string; legal_basis?: string };
  amount?: number;
  /**
   * Whether this value bears on the result it was read for. Three states,
   * because two could not tell LOST from NOT YET DECIDED:
   *   true      — the outcome rested on it;
   *   false     — a disjunction path the outcome rested on something else;
   *   undefined — nothing has decided it, so it is neither.
   * `routeProvenance` leaves every entry undefined: a route on its own has no
   * outcome to have rested on anything.
   */
  applied?: boolean;
}

/** The one exhaustive walk over the Criterion union. Every consumer of
 * criterion structure (provenance, meta, watch coverage) goes through here,
 * so a new op cannot compile without being handled — review finding #5. */
export function forEachCriterion(criteria: Criterion[], fn: (c: Criterion) => void): void {
  for (const c of criteria) {
    fn(c);
    switch (c.op) {
      case "eq": case "in": case "gte": case "points":
        break;
      case "any":
        for (const p of c.paths) forEachCriterion(p.criteria, fn);
        break;
      default: {
        const _exhaustive: never = c;
        throw new Error(`unhandled criterion op: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

/**
 * Every provenanced value one criterion node carries (exhaustive by op).
 *
 * A criterion's own `source` is one of them: since s5e a condition that is not
 * a number quotes its authority the way a threshold does, so the card's source
 * list shows the quotes behind the conditions and not only behind the numbers,
 * and the watch coverage and quote-fidelity gates cover both. It carries no
 * amount, so nothing ever marks it "does not apply to you" — that mark tells
 * two NUMBERS apart.
 */
export function provenancedValuesOf(c: Criterion): ProvenanceEntry[] {
  const condition: ProvenanceEntry[] = c.source ? [{ value: c.source }] : [];
  switch (c.op) {
    case "eq": case "in": case "any":
      return condition;
    case "gte":
      return [...condition, { label: c.threshold_label, value: c.threshold, amount: c.threshold.amount }];
    case "points":
      return c.table.source_url !== c.required.source_url || c.table.quote !== c.required.quote
        ? [...condition, { label: "points required", value: c.required }, { label: "points table", value: c.table }]
        : [...condition, { label: "points required", value: c.required }];
    default: {
      const _exhaustive: never = c;
      throw new Error(`unhandled criterion op: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** The statements a route ships, in dataset order. One accessor so no consumer
 * has to remember that the array is optional. */
export function routeStatements(route: Route): RouteStatement[] {
  return route.statements ?? [];
}

/**
 * The readings a route ships — our own words, in dataset order. The one
 * predicate for "this text is ours": `kind === "modelling"` was open-coded at
 * nine sites across two repos, which is the drift the glossary's *Still
 * reachable* entry exists to prevent (review 2026-09-07).
 */
export function routeReadings(route: Route): RouteReading[] {
  return route.readings ?? [];
}

/** All provenanced values a route rests on — what the UI must show, quoted and
 * dated. Statements are values too: a route with no threshold used to have
 * nothing to quote, and silence there read as if the promise held. */
export function routeProvenance(route: Route): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];
  forEachCriterion(route.criteria, (c) => entries.push(...provenancedValuesOf(c)));
  for (const s of routeStatements(route)) if (s.source) entries.push({ value: s.source });
  return entries;
}

/**
 * The criterion nodes an outcome actually rested on. A disjunction contributes
 * only its deciding path — the one that passed, or the nearest reachable one
 * the gap was measured against — so a consumer can name the threshold the
 * reader was measured against instead of whichever the dataset wrote first.
 * An undecided disjunction contributes nothing: nothing has decided it.
 */
export function decidingCriteria(results: CriterionResult[]): CriterionResult[] {
  const out: CriterionResult[] = [];
  for (const r of results) {
    if (r.criterion.op !== "any") { out.push(r); continue; }
    if (r.path) out.push(...decidingCriteria(r.path.criteria));
  }
  return out;
}

/**
 * Which criterion nodes this outcome rested on (true) and which it ruled out
 * (false). A node under a disjunction nothing has decided yet is left out of
 * the map entirely — it is neither.
 *
 * Membership of the deciding set used to answer both questions at once, and an
 * undecided disjunction contributes nothing to that set: a person who had
 * simply not reached the salary question was shown BOTH of a route's quotes
 * marked "does not apply to you", having been ruled out of nothing
 * (review 2026-09-07). The Chancenkarte's points table said the same thing to
 * an empty interview.
 */
function markDecided(results: CriterionResult[], into: Map<Criterion, boolean>): void {
  for (const r of results) {
    into.set(r.criterion, true);
    if (r.criterion.op !== "any" || !r.path) continue;
    for (const [index, path] of r.criterion.paths.entries())
      if (index === r.path.index) markDecided(r.path.criteria, into);
      else forEachCriterion(path.criteria, (c) => into.set(c, false));
  }
}

/**
 * A route's provenanced values, each marked with whether it applied to THIS
 * result. Both of a route's salary quotes still render — the reader may want
 * to know the other threshold exists — but the card can now say which one they
 * were measured against, instead of printing two and leaving them to guess
 * (human catch 2026-09-07).
 */
export function resultProvenance(r: RouteResult): ProvenanceEntry[] {
  const marks = new Map<Criterion, boolean>();
  markDecided(r.criteria, marks);
  const entries: ProvenanceEntry[] = [];
  forEachCriterion(r.route.criteria, (c) => {
    const applied = marks.get(c);
    for (const e of provenancedValuesOf(c))
      entries.push(applied === undefined ? { ...e } : { ...e, applied });
  });
  // A statement is not a path anyone could have missed: it stands on every
  // card the route produces.
  for (const s of routeStatements(r.route)) if (s.source) entries.push({ value: s.source, applied: true });
  return entries;
}

export function datasetMeta(dataset: Dataset): DatasetMeta {
  let newest: string | null = null;
  for (const country of dataset.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        for (const p of provenancedValuesOf(c))
          if (!newest || p.value.retrieved_at > newest) newest = p.value.retrieved_at;
      });
  // Notices and route statements are provenanced values too — a fresher one of
  // either is a fresher dataset.
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const s of routeStatements(route))
        if (s.source && (!newest || s.source.retrieved_at > newest)) newest = s.source.retrieved_at;
  for (const n of dataset.notices ?? [])
    if (!newest || n.source.retrieved_at > newest) newest = n.source.retrieved_at;
  return {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    newest_retrieved_at: newest,
  };
}
