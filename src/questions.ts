import { deriveBands, isRouteAlive } from "./engine.js";
import type { Dataset, Profile, Question } from "./types.js";

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

/**
 * Questions still worth asking given the answers so far: unanswered fields
 * referenced by at least one *live* route. A question no live route cares
 * about carries no information — asking it would be noise (e.g. salary after
 * "no job offer"). Empty result = go straight to the verdict.
 */
export function remainingQuestions(dataset: Dataset, profile: Profile): Question[] {
  const liveFields = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      if (isRouteAlive(dataset, route, profile))
        for (const c of route.criteria) liveFields.add(c.field);

  return deriveQuestions(dataset).filter(
    (q) => profile[q.field] === undefined && liveFields.has(q.field),
  );
}
