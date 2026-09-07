import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, forEachCriterion, referencedFields, routeProvenance, routeReadings, routeStatements } from "../src/engine.js";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "../src/watch/core.js";
import type { Dataset, Profile, Route, RouteResult } from "../src/types.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const dataset = read("../data/dataset.json") as Dataset;
const watchlist = read("../watch/watchlist.json") as Watchlist;
const state = read("../watch/state.json") as WatchState;

const routeOf = (id: string): Route =>
  dataset.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

const byId = (profile: Profile): Record<string, RouteResult> =>
  Object.fromEntries(evaluate(dataset, profile).map((r) => [r.route.id, r]));

function fieldsOf(route: Route): string[] {
  const out = new Set<string>();
  forEachCriterion(route.criteria, (c) => { for (const f of referencedFields(c)) out.add(f); });
  return [...out];
}

const SOURCE = "https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year";

/**
 * The orientation year carried `situation eq none` with the note "A job-search
 * permit — with an offer, transfer or hosting agreement the work routes apply
 * directly". That is our reasoning, not the IND's: no requirement about a job
 * offer appears anywhere in the page's requirement list (human read
 * 2026-09-07). It was the same defect as the Chancenkarte's "part-time work"
 * false requirement — a rule we invented, failing people who did not fail it.
 *
 * It also hid the route from exactly the person who needs it: two of the three
 * cases that earn the reduced salary criterion the s5d walk modelled are
 * holding, or having held, an orientation-year permit. The graduate WITH an
 * offer is the one for whom this route is the way to €3,122.
 */
describe("the orientation year is not closed by having a job offer", () => {
  const graduate = (situation: string): Profile => ({
    destination: "nl", citizenship: "TR", situation,
    nl_recent_grad: "yes", top200_grad: "no",
  });

  it("a Dutch graduate with a job offer reaches the route", () => {
    expect(byId(graduate("offer"))["nl-orientation-year"].status).toBe("met");
  });

  it("so does one on a transfer or a hosting agreement", () => {
    for (const situation of ["ict", "research"])
      expect(byId(graduate(situation))["nl-orientation-year"].status, situation).toBe("met");
  });

  it("and the one with nothing yet still reaches it, as before", () => {
    expect(byId(graduate("none"))["nl-orientation-year"].status).toBe("met");
  });

  it("no rule of the route reads what the person has lined up", () => {
    expect(fieldsOf(routeOf("nl-orientation-year"))).not.toContain("situation");
  });

  it("the guidance survives as guidance — the card says it, the rules do not test it", () => {
    const summary = routeOf("nl-orientation-year").summary!;
    expect(summary).toMatch(/offer/i);
    // Stated as a comparison to make, never as a bar to clear.
    expect(summary).toMatch(/does not stop you applying/i);
  });
});

describe("the orientation year states what the source states, and no more", () => {
  const route = () => routeOf("nl-orientation-year");

  it("the summary sends the reader to the list we do not check in full", () => {
    // The old summary named two cases as if they were the rule. The IND states
    // five, with conditions inside them we never ask about.
    const summary = route().summary!;
    expect(summary).toMatch(/longer than/i);
    expect(summary).toMatch(/read its own page/i);
  });

  it("the requirement the interview cannot ask is on the card, in the source's words", () => {
    const condition = routeStatements(route()).find((s) => s.kind === "precondition")!;
    // In the voice of a requirement, like every other line under that heading
    // (human catch 2026-09-07): a condition states what must be true, it does
    // not assert something about a reader we never asked.
    expect(condition.text).toMatch(/must not have previously held an orientation year permit/i);
    expect(condition.source!.quote).toBe(
      "You have not previously held a residence permit for an orientation year for the same research " +
      "for which you are now applying. Nor have you held such a permit following the completion of the " +
      "same study programme or doctoral programme.",
    );
  });

  it("the qualification the source puts on its own answer is passed on, not resolved", () => {
    const caveat = routeStatements(route()).find((s) => s.kind === "caveat")!;
    expect(caveat.source!.quote).toBe(
      "Different requirements may apply to Turkish citizens and their family members.",
    );
    // What those requirements are is not invented here.
    expect(caveat.text).toMatch(/does not say how/i);
    expect(caveat.text).toMatch(/Turkish/);
  });

  it("every statement about the law carries its source and the date a person read it", () => {
    // Every statement, with no filter to write: our own words about what we
    // did and did not model live in `route.readings` since this review, so
    // nothing in this array is ours (review 2026-09-07).
    const statements = routeStatements(route());
    // Two until s5f, four after it: the lines that used to sit in the bare
    // `preconditions` array joined them, each with its own quote. The
    // three-year deadline for a study programme is not among them — the
    // sentence that states it is already quoted by the criterion that asks
    // which programme, and printing it twice on one card is not provenance.
    expect(statements.length).toBe(4);
    for (const s of statements) {
      expect(s.source!.source_url, s.id).toBe(SOURCE);
      expect(s.source!.retrieved_at, s.id).toBe("2026-09-07");
      expect(s.source!.quote.length, s.id).toBeGreaterThan(20);
    }
    // And the reading beside them cites nobody, because it quotes nobody.
    const readings = routeReadings(route());
    expect(readings.length).toBe(1);
    for (const r of readings) expect(Object.keys(r).sort(), r.id).toEqual(["id", "text"]);
  });

  it("a statement is a value, so it reaches the card's quote list", () => {
    const quotes = routeProvenance(route()).map((p) => p.value.quote);
    for (const s of routeStatements(route()))
      if (s.source) expect(quotes).toContain(s.source.quote);
  });

  it("the limbs we do not model are recorded, with the reason and the date", () => {
    const text = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");
    expect(text).toMatch(/Erasmus Mundus/);
    expect(text).toMatch(/UFO/);
    expect(text).toMatch(/at least 10 months/);
    expect(text).toMatch(/Cultural Policy/);
    expect(text).toMatch(/development cooperation/);
    expect(text).toMatch(/simplification of a five-limb rule/i);
    for (const row of text.split("\n").filter((l) => l.startsWith("| Orientation year")))
      expect(row, row.slice(0, 60)).toMatch(/2026-09-07/);
  });
});

describe("a route statement is watched like every other value", () => {
  it("its source is covered by the watchlist, and backs a value there", () => {
    const coverage = checkCoverage(dataset, watchlist);
    expect(coverage.missing_from_watchlist).toEqual([]);
    expect(coverage.orphan_watch_entries).toEqual([]);
    const entry = watchlist.entries.find((e) => e.url === SOURCE)!;
    expect(entry.kind).toBe("value-source");
    // Human tier until 2026-09-07, on the reading that IND route pages render
    // client-side and our fetch saw a 1.4 kB shell. A fetch from this host now
    // returns the whole requirement list, and both quotes are found in it —
    // so the page is watched by machine and the gate checks the sentences
    // rather than reporting that it cannot (s5e). If that ever stops being
    // true the quotes go missing, loudly, which is the point of the check
    // below.
    expect(entry.strategy).toBe("html");
  });

  it("the quote gate finds both sentences on the page — never silently, never missing", () => {
    const result = checkQuotes(dataset, watchlist, state);
    expect(result.missing).toEqual([]);
    expect(result.unverifiable.filter((u) => u.where.startsWith("nl-orientation-year"))).toEqual([]);
    // Neither statement is missing and neither is unverifiable, so both were
    // found on the snapshot of the page they cite — the only third answer the
    // gate has left.
    for (const s of routeStatements(routeOf("nl-orientation-year")))
      if (s.source)
        expect(result.missing.map((m) => m.quote), s.id).not.toContain(s.source.quote);
    expect(result.verified).toBeGreaterThan(30);
  });
});
