import { readFileSync } from "node:fs";
import type { Dataset, Route } from "./types.js";
import { routeReadings, routeStatements } from "./engine.js";

/**
 * `data/exclusions.md`, read the way a test has to read it.
 *
 * The file is prose for a person — every researched-but-excluded route with the
 * reason it was left out — and it ends in a fenced `exclusions` block that says
 * the same facts in route ids and limb ids. Both halves are parsed here, and
 * `twinDisagreesWithProse` holds them to each other: a route recorded in the
 * prose and missing from the block, or the other way round, is a file that has
 * drifted from itself, and a test reading only the block would not notice.
 *
 * This exists because the first cut of the scope invariant never read the file
 * at all: its condition was `named in exclusions.md || states something
 * unasked`, and the right side is true of all 23 routes, so the left side was
 * dead code (Standards review, 2026-09-07).
 */

/** Where the file lives, relative to the package. */
export const EXCLUSIONS_PATH = new URL("../data/exclusions.md", import.meta.url);

/** CRLF is not content: the file is read the way a person reads it. */
export function readExclusions(path: URL = EXCLUSIONS_PATH): string {
  return readFileSync(path, "utf8").split("\r\n").join("\n");
}

const ROUTE_ID_IN_PROSE = /`([a-z]{2}-[a-z0-9-]+)`/g;
const TWIN_BLOCK = /```exclusions\n([\s\S]*?)```/;

/** The route ids the prose names in backticks, above the twin. */
export function routesInProse(text: string): Set<string> {
  const twin = text.indexOf("```exclusions");
  const prose = twin < 0 ? text : text.slice(0, twin);
  return new Set([...prose.matchAll(ROUTE_ID_IN_PROSE)].map((m) => m[1]));
}

/** The twin: route id to the limb ids the file records for it. `(none)` is a
 * real answer — the file records the route in order to say nothing is excluded. */
export function excludedLimbs(text: string): Map<string, string[]> {
  const block = TWIN_BLOCK.exec(text);
  if (!block) throw new Error("data/exclusions.md has no ```exclusions``` block");
  const out = new Map<string, string[]>();
  for (const line of block[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const at = trimmed.indexOf(":");
    if (at < 0) throw new Error(`unreadable line in the exclusions twin: ${trimmed}`);
    const route = trimmed.slice(0, at).trim();
    const rest = trimmed.slice(at + 1).trim();
    out.set(route, rest === "(none)" ? [] : rest.split(",").map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

/**
 * Where the prose and the twin do not say the same thing, in words a curator can
 * act on. Empty means the file agrees with itself.
 */
export function twinDisagreesWithProse(text: string): string[] {
  const prose = routesInProse(text);
  const twin = excludedLimbs(text);
  const problems: string[] = [];
  for (const id of prose)
    if (!twin.has(id)) problems.push(`${id} is recorded in the prose and missing from the twin`);
  for (const id of twin.keys())
    if (!prose.has(id)) problems.push(`${id} is in the twin and named nowhere in the prose`);
  return problems;
}

/** Every limb id a route can name: its statements and its readings. */
export function limbIdsOf(route: Route): Set<string> {
  return new Set([
    ...routeStatements(route).map((s) => s.id),
    ...routeReadings(route).map((r) => r.id),
  ]);
}

/**
 * Where a route's scope statement and the file disagree, both ways: a limb the
 * file records that the page does not name, and an id the page names that the
 * route does not carry.
 */
export function scopeDisagreesWithExclusions(dataset: Dataset, text: string): string[] {
  const twin = excludedLimbs(text);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes) {
      seen.add(route.id);
      const limbs = limbIdsOf(route);
      const named = new Set(route.scope.not_asked);
      for (const id of named)
        if (!limbs.has(id))
          problems.push(`${route.id}: scope names "${id}", which is neither a statement nor a reading of it`);
      for (const id of twin.get(route.id) ?? [])
        if (!named.has(id))
          problems.push(`${route.id}: exclusions.md records "${id}" and the page never names it`);
    }
  for (const id of twin.keys())
    if (!seen.has(id)) problems.push(`the twin records "${id}", which is not a route in the dataset`);
  return problems;
}
