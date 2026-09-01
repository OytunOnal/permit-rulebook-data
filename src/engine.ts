import type {
  Band, Criterion, CriterionResult, Dataset, DatasetMeta, PointsBreakdown, Profile,
  Route, RouteResult, RouteStatus,
} from "./types.js";

export function formatEUR(amount: number): string {
  const hasCents = Math.round(amount * 100) % 100 !== 0;
  return "€" + amount.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Every threshold referenced by gte-criteria on this field, ascending, deduplicated. */
export function thresholdsForField(dataset: Dataset, field: string): number[] {
  const amounts = new Set<number>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const c of route.criteria)
        if (c.op === "gte" && c.field === field) amounts.add(c.threshold.amount);
  return [...amounts].sort((a, b) => a - b);
}

/**
 * Band boundaries ARE the thresholds themselves: n thresholds produce n+1 bands.
 * A band passes a threshold iff its inclusive lower bound reaches it, so an
 * answer never straddles a decision boundary.
 */
export function deriveBands(dataset: Dataset, field: string): Band[] {
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
  return bands;
}

function fieldDef(dataset: Dataset, id: string) {
  return dataset.fields.find((f) => f.id === id);
}

/** All field ids a criterion reads (recursing through disjunctions). */
export function referencedFields(c: Criterion): string[] {
  if (c.op === "points") return c.table.items.map((i) => i.field);
  if (c.op === "any") return c.paths.flatMap((p) => p.criteria.flatMap(referencedFields));
  return [c.field];
}

function isUnknownAnswer(dataset: Dataset, field: string, answer: string | undefined): boolean {
  if (answer === undefined) return true;
  const opt = fieldDef(dataset, field)?.options?.find((o) => o.value === answer);
  return opt?.is_unknown === true;
}

function evalCriterion(dataset: Dataset, c: Criterion, profile: Profile): CriterionResult {
  if (c.op === "any") {
    const pathResults = c.paths.map((p) => p.criteria.map((pc) => evalCriterion(dataset, pc, profile)));
    // A path passes when all its criteria pass; the disjunction passes with it.
    const passed = pathResults.find((rs) => rs.every((r) => r.outcome === "pass"));
    if (passed) {
      const points = passed.find((r) => r.points)?.points;
      return points ? { criterion: c, outcome: "pass", points } : { criterion: c, outcome: "pass" };
    }
    if (pathResults.every((rs) => rs.some((r) => r.outcome === "fail"))) {
      // Every path failed — but if one path failed only by bounded gaps
      // (salary just below, points just short), that near-miss is the story
      // the gap analysis must tell. Propagate it upward.
      for (const rs of pathResults) {
        const fails = rs.filter((r) => r.outcome === "fail");
        const undecided = rs.filter((r) => r.outcome === "unknown");
        if (undecided.length === 0 && fails.every((f) => f.gap_max !== undefined || f.gap_points !== undefined)) {
          const result: CriterionResult = { criterion: c, outcome: "fail" };
          const gapsMoney = fails.map((f) => f.gap_max).filter((g): g is number => g !== undefined);
          const gapsPoints = fails.map((f) => f.gap_points).filter((g): g is number => g !== undefined);
          if (gapsMoney.length) result.gap_max = Math.max(...gapsMoney);
          if (gapsPoints.length) result.gap_points = Math.max(...gapsPoints);
          const pts = rs.find((r) => r.points)?.points;
          if (pts) result.points = pts;
          return result;
        }
      }
      return { criterion: c, outcome: "fail" };
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
        const pts = item.points[answer as string] ?? 0;
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
    return { criterion: c, outcome: answer === c.value ? "pass" : "fail" };
  }

  if (c.op === "in") {
    if (isUnknownAnswer(dataset, c.field, answer)) return { criterion: c, outcome: "unknown" };
    return { criterion: c, outcome: c.values.includes(answer) ? "pass" : "fail" };
  }

  // gte over a money_band answer
  const bands = deriveBands(dataset, c.field);
  const band = bands.find((b) => b.id === answer);
  if (!band) return { criterion: c, outcome: "unknown" };
  if (band.min !== undefined && band.min >= c.threshold.amount)
    return { criterion: c, outcome: "pass" };
  const result: CriterionResult = { criterion: c, outcome: "fail" };
  // Adjacent band just below the threshold → a bounded, honest gap ("up to X").
  if (band.max !== undefined && band.max === c.threshold.amount)
    result.gap_max = c.threshold.amount - (band.min ?? 0);
  return result;
}

function routeStatus(criteria: CriterionResult[]): RouteStatus {
  const fails = criteria.filter((r) => r.outcome === "fail");
  const unknowns = criteria.filter((r) => r.outcome === "unknown");
  if (fails.length === 0 && unknowns.length === 0) return "met";
  const allFailsGapped = fails.every((f) => f.gap_max !== undefined || f.gap_points !== undefined);
  if (fails.length > 0 && allFailsGapped && unknowns.length === 0) return "near";
  return "hold";
}

/**
 * A route is alive while no answered criterion has definitively failed.
 * "unknown" answers keep a route alive — an open gap is not a no.
 */
export function isRouteAlive(dataset: Dataset, route: Route, profile: Profile): boolean {
  return !route.criteria.some((c) => evalCriterion(dataset, c, profile).outcome === "fail");
}

/** Unanswered fields that can still flip THIS criterion's outcome. */
function undecidedFieldsOf(dataset: Dataset, c: Criterion, profile: Profile): string[] {
  const result = evalCriterion(dataset, c, profile);
  if (result.outcome !== "unknown") return [];
  if (c.op === "points")
    return c.table.items.map((i) => i.field).filter((f) => profile[f] === undefined);
  if (c.op === "any")
    // Only paths not yet failed can still be satisfied; their open questions matter.
    return c.paths
      .filter((p) => !p.criteria.some((pc) => evalCriterion(dataset, pc, profile).outcome === "fail"))
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
      const results = route.criteria.map((c) => evalCriterion(dataset, c, profile));
      if (results.some((r) => r.outcome === "fail")) continue; // dead route
      for (const c of route.criteria)
        for (const f of undecidedFieldsOf(dataset, c, profile)) fields.add(f);
    }
  }
  return fields;
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

export interface ProvenanceEntry {
  label?: string;
  value: { quote: string; source_url: string; retrieved_at: string; legal_basis?: string };
  amount?: number;
}

function provenanceOf(c: Criterion, entries: ProvenanceEntry[]): void {
  if (c.op === "gte") entries.push({ label: c.threshold_label, value: c.threshold, amount: c.threshold.amount });
  if (c.op === "points") {
    entries.push({ label: "points required", value: c.required });
    if (c.table.source_url !== c.required.source_url || c.table.quote !== c.required.quote)
      entries.push({ label: "points table", value: c.table });
  }
  if (c.op === "any")
    for (const p of c.paths) for (const pc of p.criteria) provenanceOf(pc, entries);
}

/** All provenanced values a route rests on — what the UI must show, quoted and dated. */
export function routeProvenance(route: Route): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];
  for (const c of route.criteria) provenanceOf(c, entries);
  return entries;
}

export function datasetMeta(dataset: Dataset): DatasetMeta {
  let newest: string | null = null;
  const consider = (d: string) => { if (!newest || d > newest) newest = d; };
  const walk = (c: Criterion): void => {
    if (c.op === "gte") consider(c.threshold.retrieved_at);
    if (c.op === "points") { consider(c.required.retrieved_at); consider(c.table.retrieved_at); }
    if (c.op === "any") for (const p of c.paths) p.criteria.forEach(walk);
  };
  for (const country of dataset.countries)
    for (const route of country.routes) route.criteria.forEach(walk);
  return {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    newest_retrieved_at: newest,
  };
}
