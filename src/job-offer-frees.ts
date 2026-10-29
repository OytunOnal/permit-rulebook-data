import { evaluate, fieldOptions } from "./engine.js";
import { SITUATION_FIELD } from "./types.js";
import type { Dataset, FieldOption, Profile, RouteResult, RoutesFreedByAJobOffer } from "./types.js";

/**
 * What a job offer would free for a reader who has none: per country, the
 * routes an offer there lifts out of a hard fail, and the fields they would
 * then be checked on — unanswered, or answered "I don't know". A route the
 * offer meets or brings within reach is a step (`unlocks`); the routes here
 * rest on what the reader has not told us.
 */
export function routesAJobOfferFrees(dataset: Dataset, profile: Profile): RoutesFreedByAJobOffer[] {
  const jobOfferAnswer = findJobOfferAnswer(dataset);
  const situations = fieldOptions(dataset, SITUATION_FIELD);
  if (!situations.find((o) => o.value === profile[SITUATION_FIELD])?.is_fallback) return [];
  const hardFailed = new Set(evaluate(dataset, profile).filter((r) => r.hard_fail).map((r) => r.route.id));
  const out: RoutesFreedByAJobOffer[] = [];
  for (const country of dataset.countries) {
    const place = fieldOptions(dataset, "situation_country").find((o) => o.value.toUpperCase() === country.code);
    if (!place) throw new Error(`"situation_country" has no answer for ${country.code}`);
    const withAJobOffer: Profile = { ...profile, [SITUATION_FIELD]: jobOfferAnswer.value, situation_country: place.value };
    const isFreedHere = (r: RouteResult) =>
      r.country === country.code && hardFailed.has(r.route.id) && !r.hard_fail && r.status === "hold";
    const routes = evaluate(dataset, withAJobOffer).filter(isFreedHere);
    if (!routes.length) continue;
    const open = new Set(routes.flatMap((r) => r.unknown_fields));
    out.push({ country: country.code, routes, fieldsLeftOpen: dataset.fields.map((f) => f.id).filter((f) => open.has(f)) });
  }
  return out;
}

/**
 * The situation answer that is the job offer, read from the marks so no
 * answer's value is typed: a path answer the reader can go and get, so neither
 * arranged, the fallback nor "I don't know". The schema lets any enum answer
 * carry `is_unknown`, so the situation question could gain one; it would never
 * be the job offer. Throws unless exactly one answer is.
 */
export function findJobOfferAnswer(dataset: Dataset): FieldOption {
  const jobOfferAnswers = fieldOptions(dataset, SITUATION_FIELD).filter(isJobOffer);
  if (jobOfferAnswers.length !== 1) throw new Error(`"${SITUATION_FIELD}" must offer exactly one job offer; it offers ${jobOfferAnswers.length}`);
  return jobOfferAnswers[0]!;
}

/** Whether a situation answer is the job offer: one the reader can go and get. */
function isJobOffer(option: FieldOption): boolean {
  return !option.is_arranged && !option.is_fallback && !option.is_unknown;
}
