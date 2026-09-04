import {
  deriveBands, fieldOptions, informativeFields, isRouteAlive, optionEquivalenceClasses, referencedFields,
} from "./engine.js";
import type { Dataset, Profile, Question } from "./types.js";

/**
 * The question set is the union of fields referenced by route criteria —
 * questions can never drift out of sync with the rules. Enum options come from
 * the field definition; money_band options are the threshold-derived bands.
 */
export function deriveQuestions(dataset: Dataset): Question[] {
  const referenced = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const c of route.criteria)
        for (const f of referencedFields(c)) referenced.add(f);

  const questions: Question[] = [];
  for (const def of dataset.fields) {
    if (!referenced.has(def.id)) continue;
    if (def.type === "enum") {
      // Inline options or a declared vocabulary (`options_from`) — the engine
      // expands both, so a question never has to know where its list lives.
      questions.push({ field: def.id, label: def.label, options: fieldOptions(dataset, def.id) });
    } else {
      const options = deriveBands(dataset, def.id).map((b) => ({ value: b.id, label: b.label }));
      questions.push({ field: def.id, label: def.label, options });
    }
  }
  return questions;
}

function liveRouteCount(dataset: Dataset, profile: Profile): number {
  let count = 0;
  for (const country of dataset.countries)
    for (const route of country.routes)
      if (isRouteAlive(dataset, route, profile)) count++;
  return count;
}

/**
 * Greedy information gain: score each candidate by the expected number of
 * routes still alive after its answer (uniform prior over options). The
 * question that eliminates the most, on average, is asked first. Ties keep
 * dataset field order (sort is stable).
 *
 * Options the rules cannot tell apart are scored once and weighted by how many
 * they stand for: every third-country passport is one class, so the country
 * list costs two evaluations, not 249. Weights and live-route counts are whole
 * numbers, so the weighted total is the naive total exactly — the ordering
 * cannot drift, and a test pins it against the naive computation.
 */
function orderByEliminationPower(dataset: Dataset, profile: Profile, questions: Question[]): Question[] {
  const score = (q: Question): number => {
    let total = 0;
    for (const cls of optionEquivalenceClasses(dataset, q.field, q.options.map((o) => o.value)))
      total += cls.weight * liveRouteCount(dataset, { ...profile, [q.field]: cls.value });
    return total / q.options.length;
  };
  return questions
    .map((q, i) => ({ q, i, s: score(q) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.q);
}

/**
 * Questions still worth asking given the answers so far: unanswered fields
 * that can still change some live route's outcome, most-eliminating first.
 * A question no live, undecided criterion reads carries no information —
 * asking it would be noise (e.g. salary after "no job offer", or another
 * points item after the points requirement is already met).
 * Empty result = go straight to the verdict.
 */
export function remainingQuestions(dataset: Dataset, profile: Profile): Question[] {
  const informative = informativeFields(dataset, profile);
  const candidates = deriveQuestions(dataset).filter(
    (q) => profile[q.field] === undefined && informative.has(q.field),
  );
  // ask_first fields (the destination) come before the greedy ordering — the
  // interview's framing beats a marginal elimination win.
  const pinned = candidates.filter((q) => dataset.fields.find((f) => f.id === q.field)?.ask_first);
  const rest = candidates.filter((q) => !pinned.includes(q));
  return [...pinned, ...orderByEliminationPower(dataset, profile, rest)];
}
