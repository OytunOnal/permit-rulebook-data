import type {
  Band, Criterion, CriterionResult, Dataset, DatasetMeta, Profile,
  ProvenancedAmount, Route, RouteResult, RouteStatus,
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

function evalCriterion(dataset: Dataset, c: Criterion, profile: Profile): CriterionResult {
  const answer = profile[c.field];
  if (answer === undefined) return { criterion: c, outcome: "unknown" };

  if (c.op === "eq") {
    const def = fieldDef(dataset, c.field);
    const opt = def?.options?.find((o) => o.value === answer);
    if (opt?.is_unknown) return { criterion: c, outcome: "unknown" };
    return { criterion: c, outcome: answer === c.value ? "pass" : "fail" };
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
  if (fails.length > 0 && fails.every((f) => f.gap_max !== undefined) && unknowns.length === 0)
    return "near";
  return "hold";
}

/**
 * A route is alive while no answered criterion has definitively failed.
 * "unknown" answers keep a route alive — an open gap is not a no.
 */
export function isRouteAlive(dataset: Dataset, route: Route, profile: Profile): boolean {
  return !route.criteria.some((c) => evalCriterion(dataset, c, profile).outcome === "fail");
}

export function evaluate(dataset: Dataset, profile: Profile): RouteResult[] {
  const results: RouteResult[] = [];
  for (const country of dataset.countries) {
    for (const route of country.routes) {
      const criteria = route.criteria.map((c) => evalCriterion(dataset, c, profile));
      const status = routeStatus(criteria);
      const gaps = criteria.filter((c) => c.gap_max !== undefined).map((c) => c.gap_max as number);
      results.push({
        route,
        country: country.code,
        status,
        criteria,
        gap_max: gaps.length ? Math.max(...gaps) : undefined,
        unknown_fields: criteria.filter((c) => c.outcome === "unknown").map((c) => c.criterion.field),
      });
    }
  }
  const order: RouteStatus[] = ["met", "near", "hold"];
  return results.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
}

/** All provenanced amounts a route rests on — what the UI must show, quoted and dated. */
export function routeProvenance(route: Route): { label?: string; value: ProvenancedAmount }[] {
  return route.criteria
    .filter((c): c is Extract<Criterion, { op: "gte" }> => c.op === "gte")
    .map((c) => ({ label: c.threshold_label, value: c.threshold }));
}

export function datasetMeta(dataset: Dataset): DatasetMeta {
  let newest: string | null = null;
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const c of route.criteria)
        if (c.op === "gte" && (!newest || c.threshold.retrieved_at > newest))
          newest = c.threshold.retrieved_at;
  return {
    schema_version: dataset.schema_version,
    dataset_version: dataset.dataset_version,
    newest_retrieved_at: newest,
  };
}
