import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schema/ruleset.schema.json" with { type: "json" };
import type { Dataset } from "./types.js";

export interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

/**
 * Boundary validation: everything entering the engine passes the JSON Schema
 * first. A value without its quote, source URL or retrieval date is not data —
 * the build must fail naming the missing field.
 */
export function validateDataset(data: unknown): ValidationResult {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateFn = ajv.compile(schema as object);
  const ok = validateFn(data) as boolean;
  const errors: ValidationError[] = (validateFn.errors ?? []).map((e) => ({
    path: e.instancePath || "/",
    message: e.message ?? "invalid",
    keyword: e.keyword,
  }));
  if (ok) errors.push(...semanticErrors(data as Dataset));
  return { ok: ok && errors.length === 0, errors };
}

/**
 * Cross-cutting rules JSON Schema cannot express (review catches):
 * - route ids must be unique dataset-wide (evaluate/unlocks key Maps by id);
 * - a threshold restated under the same quote (NL ICT restates the HSM rows
 *   verbatim) must carry the same amount, source and retrieval date everywhere
 *   — updating one copy and missing another must fail the build, not silently
 *   disagree. Distinct quotes may share an amount (ES: "umbral general" and
 *   "umbral único" both read €41,356.36 — different rows, same number).
 */
function semanticErrors(dataset: Dataset): ValidationError[] {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const thresholds = new Map<string, { amount: number; source_url: string; retrieved_at: string; route: string }>();
  for (const country of dataset.countries)
    for (const route of country.routes) {
      if (seenIds.has(route.id))
        errors.push({ path: `/countries/${country.code}/routes/${route.id}`, message: "duplicate route id", keyword: "uniqueRouteId" });
      seenIds.add(route.id);
      const walk = (cs: import("./types.js").Criterion[]): void => {
        for (const c of cs) {
          if (c.op === "any") { for (const p of c.paths) walk(p.criteria); continue; }
          if (c.op !== "gte") continue;
          const key = `${c.field}#${c.threshold.quote}`;
          const prev = thresholds.get(key);
          if (!prev) {
            thresholds.set(key, { amount: c.threshold.amount, source_url: c.threshold.source_url, retrieved_at: c.threshold.retrieved_at, route: route.id });
          } else if (prev.amount !== c.threshold.amount || prev.source_url !== c.threshold.source_url || prev.retrieved_at !== c.threshold.retrieved_at) {
            errors.push({
              path: `/countries/${country.code}/routes/${route.id}`,
              message: `threshold for ${c.field} restates the quote used in ${prev.route} with a different amount/source/retrieved_at — update every copy together`,
              keyword: "thresholdConsistency",
            });
          }
        }
      };
      walk(route.criteria);
    }
  return errors;
}

export function assertValidDataset(data: unknown): Dataset {
  const result = validateDataset(data);
  if (!result.ok) {
    // With oneOf schemas ajv reports every branch; the deepest instancePath
    // points closest to the actual offending field.
    const deepest = [...result.errors].sort((a, b) => b.path.length - a.path.length)[0];
    throw new Error(
      `dataset invalid: ${deepest.path} ${deepest.message} (${result.errors.length} error(s) total)`,
    );
  }
  return data as Dataset;
}
