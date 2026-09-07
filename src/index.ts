export type * from "./types.js";
export { evaluate, deriveBands, thresholdsForField, routeProvenance, routeStatements, datasetMeta, formatEUR, formatEURPer, notices, matchOptions, foldForSearch, isRouteAlive, informativeFields, referencedFields, forEachCriterion, unlocks, fieldOptions, optionEquivalenceClasses } from "./engine.js";
export { deriveQuestions, remainingQuestions } from "./questions.js";
export {
  reasonFor, criterionPhrase, subjectOf, shortLabelOf, answerLabel, unlockTitleOf,
  declaredPlace, isLocalization, isPlacedElsewhere, liveUnknowns, mootWith, joinOr, joinAnd,
} from "./verdict.js";
export type { Reason, ReasonRow } from "./verdict.js";
export { countryClasses, countryOptions, classOfCountry, countryVocabulary } from "./countries.js";
export type { CountryClass, CountryVocabulary } from "./countries.js";
