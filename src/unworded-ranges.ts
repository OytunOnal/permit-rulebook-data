import { forEachCriterion } from "./engine.js";
import type { Criterion, Dataset } from "./types.js";

export interface UnwordedRangeError {
  path: string;
  message: string;
  keyword: "orderedRangeHasWords";
}

/**
 * The criteria that accept two or more rungs of an ordered question and carry
 * no `short_reason`. Composed from the options, such a criterion reads the
 * rungs out ("3 to under 5 or 5+ years …") where a reader wants the range
 * ("at least 3 years …"), and only the dataset can say the range in words.
 */
export function unwordedRangeErrors(dataset: Dataset): UnwordedRangeError[] {
  const ordered = new Set(dataset.fields.filter((f) => f.ordered).map((f) => f.id));
  const isUnwordedRange = (c: Criterion): c is Extract<Criterion, { op: "in" }> =>
    c.op === "in" && c.values.length >= 2 && ordered.has(c.field) && !c.short_reason;
  const errors: UnwordedRangeError[] = [];
  for (const country of dataset.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        if (!isUnwordedRange(c)) return;
        errors.push({
          path: `/countries/${country.code}/routes/${route.id}`,
          message: `${route.id}: a criterion accepts ${c.values.length} rungs of ${c.field}, an ordered question — give it a "short_reason" that says the range in one phrase`,
          keyword: "orderedRangeHasWords",
        });
      });
  return errors;
}
