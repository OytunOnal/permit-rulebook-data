export type * from "./types.js";
export type { ProvenanceEntry } from "./engine.js";
export { evaluate, deriveBands, thresholdsForField, routeProvenance, resultProvenance, decidingCriteria, routeStatements, routeReadings, statementSources, noticeSources, carveOutFor, bindsReader, closedBy, isClosed, provenancedValuesOf, datasetMeta, formatEUR, formatEURPer, notices, matchOptions, foldForSearch, isRouteAlive, isScored, informativeFields, referencedFields, forEachCriterion, unlocks, fieldOptions, optionEquivalenceClasses, contradictionsIn, situationsAsked } from "./engine.js";
export { deriveQuestions, remainingQuestions } from "./questions.js";
export {
  reasonFor, criterionPhrase, subjectOf, shortLabelOf, answerLabel, unlockTitleOf,
  declaredPlace, optionMeans, unlockProfile, unlockMeansOf, gapCriterionOf, isLocalization, isPlacedElsewhere, liveUnknowns, mootWith, joinOr, joinAnd,
} from "./verdict.js";
export type { Reason, ReasonRow } from "./verdict.js";
export { quotedSpans, hasUnbalancedQuotationMark, quotedWithoutProvenance, renderableTexts, offenceMessage, proseProvenance } from "./prose.js";
export type { ProseProvenance, QuotationOffence, RenderableKind, RenderableText } from "./prose.js";
export { quoteLanguage, sourceUrls, unmappedSources, QUOTE_LANGUAGES, LANGUAGE_NAMES } from "./lang.js";
export { QUOTED_NOT_SCORED, DESTINATION_FIELD, SITUATION_FIELD } from "./types.js";
export { scopeWords, scopeLine, statedNotAsked, askedByCriterion, countedWords, NUMBER_WORDS, SCOPE_VALUES } from "./scope.js";
export { routesInProse, excludedLimbs, twinDisagreesWithProse, limbIdsOf, scopeDisagreesWithExclusions } from "./exclusions.js";
export { countryClasses, countryOptions, classOfCountry, countryAdjective, countryPhrase, countryVocabulary } from "./countries.js";
export type { CountryClass, CountryVocabulary } from "./countries.js";
// What the watch left behind, and what a page owes a reader because of it —
// never the watch itself, which fetches and hashes and belongs to Node. The
// walk from a source to the values it backs stays inside the package: the site
// asks what went unread, not how that is worked out (s11).
export { unreadClause, unreadSentence, unreadSources } from "./watch/state.js";
export type { UnreadClause, UnreadSource, WatchState } from "./watch/state.js";
