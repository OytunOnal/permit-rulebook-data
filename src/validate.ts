import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../schema/ruleset.schema.json" with { type: "json" };
import { countryVocabulary, vocabularyErrors } from "./countries.js";
import { deriveBands, fieldOptions } from "./engine.js";
import { UNKNOWN_BAND } from "./questions.js";
import { offenceMessage, quotedWithoutProvenance } from "./prose.js";
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
 *   "umbral único" both read €41,356.36 — different rows, same number);
 * - a field whose options come from the country vocabulary may only be tested
 *   against something that vocabulary knows: a country code or a class. A
 *   criterion or notice naming "schengen_only" would silently never match,
 *   and a silent never-match on citizenship is a wrong answer, not a bug
 *   report. The vocabulary's own invariants are checked here too, so
 *   `countries.json` cannot ship a country with no class or two.
 */
function semanticErrors(dataset: Dataset): ValidationError[] {
  const errors: ValidationError[] = [...vocabularyErrors(countryVocabulary)];

  /**
   * s5e: nothing reaches a screen in quotation marks without provenance beside
   * it that covers the quoted words. Written over the text rather than over the
   * fields, so moving a sentence to another slot is not a way to silence it —
   * and the message names both honest ways out, because a gate whose easiest
   * fix is deleting the quotation marks is a gate that teaches dishonesty.
   */
  for (const offence of quotedWithoutProvenance(dataset))
    errors.push({ path: offence.path, message: offenceMessage(offence), keyword: "quotedWithoutProvenance" });
  const seenIds = new Set<string>();
  const thresholds = new Map<string, { amount: number; source_url: string; retrieved_at: string; route: string }>();

  /**
   * s5d: a criterion may only name an answer the dataset can put into words. The
   * verdict line says what a route asks for; where the words are missing the
   * only thing left to say is the field's own id, which is how "Not met:
   * situation" shipped (product-critique v0.7, B3). There is deliberately no
   * fallback — the build fails instead.
   */
  const optionShorts = new Map<string, Set<string>>();
  for (const f of dataset.fields) {
    const named = new Set<string>();
    for (const o of f.options ?? []) if (o.short) named.add(o.value);
    optionShorts.set(f.id, named);
  }
  const classShorts = new Set(
    Object.entries(countryVocabulary.classes).filter(([, c]) => c.short).map(([id]) => id),
  );
  // A country's own name is already the noun phrase, and the country list is
  // generated — so a criterion naming a country code needs nothing extra. Which
  // codes exist is the vocabulary check's business, just below.
  const generatedFields = new Set(dataset.fields.filter((f) => f.options_from).map((f) => f.id));
  const checkWords = (path: string, route: string, c: import("./types.js").Criterion, field: string, values: string[]) => {
    if (c.short_reason) return; // the criterion says it in its own words
    if (generatedFields.has(field)) return;
    for (const v of values)
      if (!optionShorts.get(field)?.has(v) && !classShorts.has(v))
        errors.push({
          path,
          message: `${route}: a criterion names ${field} = "${v}", which carries no noun phrase — give the option a "short", or the criterion a "short_reason"`,
          keyword: "answerHasWords",
        });
  };

  const vocabularyValues = new Set([
    ...Object.keys(countryVocabulary.classes),
    ...countryVocabulary.countries.map((c) => c.code),
  ]);
  const vocabularyFields = new Set(
    dataset.fields.filter((f) => f.options_from === "countries").map((f) => f.id),
  );
  const checkVocabulary = (path: string, field: string, values: string[]) => {
    if (!vocabularyFields.has(field)) return;
    for (const v of values)
      if (!vocabularyValues.has(v))
        errors.push({ path, message: `${field} is tested against "${v}", which is neither a country nor a class in countries.json`, keyword: "knownCountryValue" });
  };

  for (const country of dataset.countries)
    for (const route of country.routes) {
      const path = `/countries/${country.code}/routes/${route.id}`;
      if (seenIds.has(route.id))
        errors.push({ path, message: "duplicate route id", keyword: "uniqueRouteId" });
      seenIds.add(route.id);
      const walk = (cs: import("./types.js").Criterion[]): void => {
        for (const c of cs) {
          if (c.op === "any") { for (const p of c.paths) walk(p.criteria); continue; }
          if (c.op === "eq") { checkVocabulary(path, c.field, [c.value]); checkWords(path, route.id, c, c.field, [c.value]); continue; }
          if (c.op === "in") { checkVocabulary(path, c.field, c.values); checkWords(path, route.id, c, c.field, c.values); continue; }
          // Points keys bypass `satisfies` by design, so a vocabulary field
          // scored by class would silently never match (review).
          if (c.op === "points") {
            for (const item of c.table.items) checkVocabulary(path, item.field, Object.keys(item.points));
            continue;
          }
          if (c.op !== "gte") continue;
          const key = `${c.field}#${c.threshold.quote}`;
          const prev = thresholds.get(key);
          if (!prev) {
            thresholds.set(key, { amount: c.threshold.amount, source_url: c.threshold.source_url, retrieved_at: c.threshold.retrieved_at, route: route.id });
          } else if (prev.amount !== c.threshold.amount || prev.source_url !== c.threshold.source_url || prev.retrieved_at !== c.threshold.retrieved_at) {
            errors.push({
              path,
              message: `threshold for ${c.field} restates the quote used in ${prev.route} with a different amount/source/retrieved_at — update every copy together`,
              keyword: "thresholdConsistency",
            });
          }
        }
      };
      walk(route.criteria);
    }

  for (const n of dataset.notices ?? [])
    checkVocabulary(`/notices/${n.id}`, n.when.field, n.when.value !== undefined ? [n.when.value] : (n.when.values ?? []));

  /**
   * A pair of answers that cannot both be true is only worth declaring if both
   * sides name answers a reader can actually give. A typo in a field id or a
   * value makes the pair unreachable, and an unreachable warning is worse than
   * none: it looks like the screen is watching when it is not (Standards
   * review, 2026-09-08). The schema cannot see this — it knows the shape of a
   * field name, not which ones exist — so the build does.
   */
  for (const pair of dataset.contradictions ?? []) {
    const path = `/contradictions/${pair.id}`;
    for (const side of pair.when) {
      const def = dataset.fields.find((f) => f.id === side.field);
      if (!def) {
        errors.push({ path, message: `no field "${side.field}" — a pair that names a field this dataset does not have can never fire`, keyword: "knownContradictionField" });
        continue;
      }
      const answers = def.type === "money_band"
        // Bands are derived from the thresholds, plus the door for a reader
        // none of them fits.
        ? new Set([...deriveBands(dataset, def.id).map((b) => b.id), UNKNOWN_BAND])
        : new Set(fieldOptions(dataset, def.id).map((o) => o.value));
      for (const value of side.in)
        if (!answers.has(value))
          errors.push({ path, message: `${side.field} has no answer "${value}" — a pair that names an answer nobody can give can never fire`, keyword: "knownContradictionAnswer" });
    }
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
