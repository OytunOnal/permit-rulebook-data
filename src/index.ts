export type * from "./types.js";
export type { ProvenanceEntry } from "./engine.js";
export { evaluate, deriveBands, thresholdsForField, routeProvenance, resultProvenance, decidingCriteria, routeStatements, routeReadings, provenancedValuesOf, datasetMeta, formatEUR, formatEURPer, notices, matchOptions, foldForSearch, isRouteAlive, informativeFields, referencedFields, forEachCriterion, unlocks, fieldOptions, optionEquivalenceClasses } from "./engine.js";
export { deriveQuestions, remainingQuestions } from "./questions.js";
export {
  reasonFor, criterionPhrase, subjectOf, shortLabelOf, answerLabel, unlockTitleOf,
  declaredPlace, optionMeans, isLocalization, isPlacedElsewhere, liveUnknowns, mootWith, joinOr, joinAnd,
} from "./verdict.js";
export type { Reason, ReasonRow } from "./verdict.js";
export { quotedSpans, hasUnbalancedQuotationMark, quotedWithoutProvenance, renderableTexts, offenceMessage, proseProvenance } from "./prose.js";
export type { ProseProvenance, QuotationOffence, RenderableKind, RenderableText } from "./prose.js";
export { quoteLanguage, sourceUrls, unmappedSources, QUOTE_LANGUAGES, LANGUAGE_NAMES } from "./lang.js";
export { scopeWords, statedNotAsked, SCOPE_VALUES } from "./scope.js";
export { routesInProse, excludedLimbs, twinDisagreesWithProse, limbIdsOf, scopeDisagreesWithExclusions } from "./exclusions.js";
export { countryClasses, countryOptions, classOfCountry, countryPhrase, countryVocabulary } from "./countries.js";
export type { CountryClass, CountryVocabulary } from "./countries.js";
