import type { Criterion, CriterionResult, DecidedPath } from "./types.js";

/**
 * The judgement of a disjunction (`any`): its outcome, the path it rested on,
 * and whether its paths can still lead somewhere.
 *
 * A path's criteria may be disjunctions themselves (the Dutch routes nest an
 * `any` in an `any`), so judging one needs the rules for every other kind of
 * criterion. They come in as a `CriterionJudge`, bound to one dataset and one
 * profile, which keeps this module free of the engine it is called from.
 */

export type Disjunction = Extract<Criterion, { op: "any" }>;

/** The rules for a single criterion, bound to one dataset and one profile. */
export interface CriterionJudge {
  evaluate(c: Criterion): CriterionResult;
  isHardFail(r: CriterionResult): boolean;
}

/**
 * Whether this criterion result leaves its route or path still reachable: it
 * did not fail, or it failed only by a bounded gap the person can still close.
 *
 * The one definition. It had drifted into four spellings of the same
 * conjunction — the disjunction's "every failure is bounded", the status
 * rule's `allFailsGapped`, the question-picker's "this path can still be
 * MEASURED", and `isHardFail`'s two early returns. They composed only by
 * coincidence, and the next edit to any one of them would have moved a
 * verdict without moving the others (review 2026-09-07). Route status reads it
 * directly; `isHardFail` adds the improvable answers to it, and `isPathOpen`,
 * which the questions read, is built on `isHardFail` — never spelled again.
 */
export function stillReachable(r: CriterionResult): boolean {
  return r.outcome !== "fail" || r.gap_max !== undefined || r.gap_points !== undefined;
}

/**
 * Whether a disjunction's path can still lead somewhere: none of its criteria
 * hard-failed. The one test for a path, read by the hard fail, by the
 * disjunction's own outcome and by the questions it asks, so a path that keeps
 * a route alive always asks its open questions.
 */
export function isPathOpen(results: CriterionResult[], judge: CriterionJudge): boolean {
  return !results.some((r) => judge.isHardFail(r));
}

/**
 * A failed disjunction reads every path's fields, but only one path has to
 * hold, so it is a hard fail only when every path holds a hard-failing
 * criterion. A path that failed only on answers the reader can improve, or
 * only by a bounded gap, keeps it open: a degree awaiting German recognition
 * still leads to the shortage Blue Card when its IT path is closed.
 */
export function hasNoOpenPath(r: CriterionResult, judge: CriterionJudge): boolean {
  return pathResultsOf(r).every((rs) => !isPathOpen(rs, judge));
}

/** A disjunction's results, path by path, as its evaluation made them. */
export function pathResultsOf(r: CriterionResult): CriterionResult[][] {
  if (r.criterion.op !== "any" || r.path_results === undefined)
    throw new Error(`not an evaluated disjunction: ${JSON.stringify(r.criterion)}`);
  return r.path_results;
}

/**
 * Which of two fully-gapped disjunction paths is the shorter way through.
 * Euros and points are not comparable, so a path that closes on one currency
 * beats one that needs both; within a currency the smaller gap wins. Ties keep
 * the earlier path, so the dataset's own order stays the tie-break.
 */
function isNearerThan(a: CriterionResult, b: CriterionResult): boolean {
  const currencies = (r: CriterionResult) => (r.gap_max !== undefined ? 1 : 0) + (r.gap_points !== undefined ? 1 : 0);
  if (currencies(a) !== currencies(b)) return currencies(a) < currencies(b);
  if (a.gap_max !== undefined && b.gap_max !== undefined && a.gap_max !== b.gap_max) return a.gap_max < b.gap_max;
  if (a.gap_points !== undefined && b.gap_points !== undefined && a.gap_points !== b.gap_points)
    return a.gap_points < b.gap_points;
  return false;
}

/** Which path decided a disjunction, in the shape a consumer can walk. */
function decidedPath(c: Disjunction, index: number, criteria: CriterionResult[]): DecidedPath {
  const label = c.paths[index].label;
  return label === undefined ? { index, criteria } : { index, label, criteria };
}

const isFail = (r: CriterionResult): boolean => r.outcome === "fail";
const isUnknown = (r: CriterionResult): boolean => r.outcome === "unknown";

/**
 * A disjunction's outcome. A path passes when all its criteria pass; the
 * disjunction passes with it. WHICH path passed is the story the card tells —
 * a route met through the reduced salary must name the reduced threshold, not
 * the first one written. Every path's results ride on the outcome, so what
 * reads the paths afterwards never evaluates them again.
 */
export function evalDisjunction(c: Disjunction, judge: CriterionJudge): CriterionResult {
  const pathResults = c.paths.map((p) => p.criteria.map((pc) => judge.evaluate(pc)));
  return { ...outcomeOf(c, pathResults, judge), path_results: pathResults };
}

function outcomeOf(c: Disjunction, pathResults: CriterionResult[][], judge: CriterionJudge): CriterionResult {
  const passedIndex = pathResults.findIndex((rs) => rs.every((r) => r.outcome === "pass"));
  if (passedIndex >= 0) {
    const passed = pathResults[passedIndex];
    const points = passed.find((r) => r.points)?.points;
    const result: CriterionResult = { criterion: c, outcome: "pass", path: decidedPath(c, passedIndex, passed) };
    if (points) result.points = points;
    return result;
  }
  if (pathResults.every((rs) => rs.some(isFail))) return everyPathFailed(c, pathResults, judge);
  // Undecided: surface points progress from a still-open points path, if any.
  const open = pathResults.find((rs) => !rs.some(isFail) && rs.some((r) => r.points));
  const points = open?.find((r) => r.points)?.points;
  return points ? { criterion: c, outcome: "unknown", points } : { criterion: c, outcome: "unknown" };
}

/**
 * Every path failed — but if a path failed only by bounded gaps (salary just
 * below, points just short), that near-miss is the story the gap analysis
 * must tell, and it is the deciding path.
 *
 * An open path (no hard-failing criterion) whose own answers are still
 * unanswered has not had its say: answering them turns "nothing decided" into
 * a measured shortfall or a shortfall the reader can close. Reporting a fail
 * there retires the route's remaining questions, so the answer that would
 * have made it a near miss is never asked — a €0 transfer to the Netherlands
 * read as a dead ICT route because nobody asked the applicant's age (found by
 * the completed-interview property, 2026-09-07).
 */
function everyPathFailed(c: Disjunction, pathResults: CriterionResult[][], judge: CriterionJudge): CriterionResult {
  const nearest = nearestBoundedPath(c, pathResults);
  if (nearest) return nearest;
  if (pathResults.some((rs) => rs.some(isUnknown) && isPathOpen(rs, judge))) return { criterion: c, outcome: "unknown" };
  const index = indexOfOpenPathWithFewestUnmet(pathResults, judge);
  return index === undefined
    ? { criterion: c, outcome: "fail" }
    : { criterion: c, outcome: "fail", path: decidedPath(c, index, pathResults[index]) };
}

/**
 * Where no path failed only by a bounded gap, the deciding path is the open
 * one (no hard-failing criterion) with the fewest unmet criteria, ties to the
 * dataset's order: an IT worker short of the experience rung is told the rung
 * on the IT path, not a degree they declared they do not have. Undefined when
 * every path holds a hard fail.
 */
function indexOfOpenPathWithFewestUnmet(pathResults: CriterionResult[][], judge: CriterionJudge): number | undefined {
  const unmet = (rs: CriterionResult[]) => rs.filter((r) => r.outcome !== "pass").length;
  let best: number | undefined;
  for (const [index, rs] of pathResults.entries()) {
    if (!isPathOpen(rs, judge)) continue;
    if (best === undefined || unmet(rs) < unmet(pathResults[best])) best = index;
  }
  return best;
}

/**
 * With two salary paths on one route (full criterion OR reduced criterion plus
 * the fact that earns it) the honest distance is the NEAREST reachable path,
 * not whichever was written first: a graduate under €3,122 is €3,122 away,
 * never €4,357 away. Paths the profile cannot reach (a flat "no" on the
 * qualifying fact) carry an ungapped fail and are excluded here, so no gap is
 * ever measured against a threshold the person cannot get to.
 */
function nearestBoundedPath(c: Disjunction, pathResults: CriterionResult[][]): CriterionResult | undefined {
  let best: CriterionResult | undefined;
  for (const [index, rs] of pathResults.entries()) {
    if (rs.some(isUnknown) || !rs.filter(isFail).every(stillReachable)) continue;
    const result = boundedPathResult(c, index, rs);
    if (best === undefined || isNearerThan(result, best)) best = result;
  }
  return best;
}

/**
 * The criterion nodes an outcome actually rested on. A disjunction contributes
 * only its deciding path — the one that passed, the nearest reachable one the
 * gap was measured against, or the open one with the fewest unmet criteria —
 * so a consumer can name the threshold the reader was measured against
 * instead of whichever the dataset wrote first.
 * An undecided disjunction contributes nothing: nothing has decided it.
 */
export function decidingCriteria(results: CriterionResult[]): CriterionResult[] {
  const out: CriterionResult[] = [];
  for (const r of results) {
    if (r.criterion.op !== "any") { out.push(r); continue; }
    if (r.path) out.push(...decidingCriteria(r.path.criteria));
  }
  return out;
}

/** A path that failed only by bounded gaps, as the disjunction's failed result. */
function boundedPathResult(c: Disjunction, index: number, rs: CriterionResult[]): CriterionResult {
  const fails = rs.filter(isFail);
  const result: CriterionResult = { criterion: c, outcome: "fail", path: decidedPath(c, index, rs) };
  const gapsMoney = fails.map((f) => f.gap_max).filter((g): g is number => g !== undefined);
  const gapsPoints = fails.map((f) => f.gap_points).filter((g): g is number => g !== undefined);
  if (gapsMoney.length) result.gap_max = Math.max(...gapsMoney);
  if (gapsPoints.length) result.gap_points = Math.max(...gapsPoints);
  const pts = rs.find((r) => r.points)?.points;
  if (pts) result.points = pts;
  return result;
}
