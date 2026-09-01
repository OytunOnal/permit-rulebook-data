import { deriveBands } from "./engine.js";
import type { Dataset, Question } from "./types.js";

/**
 * The question set is the union of fields referenced by route criteria —
 * questions can never drift out of sync with the rules. Enum options come from
 * the field definition; money_band options are the threshold-derived bands.
 * (Ordering by information gain arrives in S2; for now, dataset field order.)
 */
export function deriveQuestions(dataset: Dataset): Question[] {
  const referenced = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const c of route.criteria) referenced.add(c.field);

  const questions: Question[] = [];
  for (const def of dataset.fields) {
    if (!referenced.has(def.id)) continue;
    if (def.type === "enum") {
      questions.push({ field: def.id, label: def.label, options: def.options ?? [] });
    } else {
      const options = deriveBands(dataset, def.id).map((b) => ({ value: b.id, label: b.label }));
      questions.push({ field: def.id, label: def.label, options });
    }
  }
  return questions;
}
