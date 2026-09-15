export type * from "./types.js";
export type { ProvenanceEntry } from "./engine.js";
export { evaluate, deriveBands, thresholdsForField, routeProvenance, resultProvenance, decidingCriteria, routeStatements, routeReadings, statementSources, noticeSources, carveOutFor, bindsReader, closedBy, isClosed, provenancedValuesOf, datasetMeta, formatEUR, formatEURPer, notices, matchOptions, foldForSearch, isRouteAlive, isScored, informativeFields, referencedFields, forEachCriterion, unlocks, fieldOptions, optionEquivalenceClasses, contradictionsIn } from "./engine.js";
export { deriveQuestions, remainingQuestions } from "./questions.js";
export {
  reasonFor, criterionPhrase, subjectOf, shortLabelOf, answerLabel, unlockTitleOf,
  declaredPlace, optionMeans, unlockProfile, unlockMeansOf, gapCriterionOf, isLocalization, isPlacedElsewhere, liveUnknowns, mootWith, joinOr, joinAnd,
} from "./verdict.js";
export type { Reason, ReasonRow } from "./verdict.js";
export { quotedSpans, hasUnbalancedQuotationMark, quotedWithoutProvenance, renderableTexts, offenceMessage, proseProvenance } from "./prose.js";
export type { ProseProvenance, QuotationOffence, RenderableKind, RenderableText } from "./prose.js";
export { quoteLanguage, sourceUrls, unmappedSources, QUOTE_LANGUAGES, LANGUAGE_NAMES } from "./lang.js";
export { QUOTED_NOT_SCORED } from "./types.js";
export { scopeWords, scopeLine, statedNotAsked, countedWords, NUMBER_WORDS, SCOPE_VALUES } from "./scope.js";
export { routesInProse, excludedLimbs, twinDisagreesWithProse, limbIdsOf, scopeDisagreesWithExclusions } from "./exclusions.js";
export { countryClasses, countryOptions, classOfCountry, countryAdjective, countryPhrase, countryVocabulary } from "./countries.js";
export type { CountryClass, CountryVocabulary } from "./countries.js";
// What the watch left behind, and what a page owes a reader because of it. The
// state's shape and the derivations over it — never the watch itself, which
// fetches and hashes and belongs to Node (s11).
export { datasetSourceCountries, datasetSourceUrls, unreadSentence, unreadSources } from "./watch/state.js";
export type { Snapshot, UnreadEntry, UnreadSource, WatchState } from "./watch/state.js";
