import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { routeStatements } from "../src/engine.js";
import { UNSOURCED_REASONS } from "../src/types.js";
import type { Dataset, Route } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const routes = (): Route[] => dataset.countries.flatMap((c) => c.routes);
const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;

/** Everything a card lists under "Also required — not checked here": the plain
 * lines and the ones that carry a quote. */
const requirementsOf = (route: Route): string[] =>
  [...(route.preconditions ?? []), ...routeStatements(route).filter((s) => s.kind === "precondition").map((s) => s.text)];

const caveatsOf = (route: Route): string[] =>
  routeStatements(route).filter((s) => s.kind === "caveat").map((s) => s.text);

/**
 * Requirement voice: "must be", "needs to", "has to". A line in this voice
 * states a condition; a line without it states a fact.
 */
const REQUIREMENT = /\b(must|need|needs|should|required)\b/i;

/**
 * Finite verbs that turn a clause into a claim about someone — "your employer
 * IS on the list", "the transfer LASTS more than 90 days". Under a heading
 * that says we do not check these, every one of them asserts something we know
 * nothing about. Only the third-person forms and the copulas are listed: a
 * bare "move" or "last" is as often a noun ("three months before the move"),
 * and the reader-as-subject case is caught by its own rule below. The list
 * grows when a new assertion is written — `appears` was added after review
 * found "Your employer appears on the IND list" walking straight through
 * (2026-09-07).
 */
const ASSERTS = new RegExp(
  "\\b(is|are|was|were|appears|applies|matches|recognises|recognizes|trades|qualifies|moves|lasts|" +
  "goes|has|holds|covers|counts|judges|decides|depends|works|pays|means|gets|includes|earns|exists)\\b",
  "i",
);

/**
 * The clause that carries the claim. Parentheses are asides ("(health, law and
 * similar)"), and a leading "If …" sets the scope of a requirement rather than
 * asserting anything — what follows it is the part that has to read as a
 * requirement. Everything after the first break is elaboration.
 */
function mainClause(text: string): string {
  const flat = text.replace(/\([^)]*\)/g, " ");
  const parts = flat.split(/[,:;—]/).map((s) => s.trim()).filter(Boolean);
  let i = 0;
  while (i < parts.length - 1 && /^(if|where|when|unless)\b/i.test(parts[i])) i++;
  return parts[i] ?? flat;
}

/**
 * A LINT, and only a lint — the name says so now, because the last one did not
 * (review 2026-09-07). It flags a line when the clause carrying the claim uses
 * one of the verbs above, or takes the reader as its subject. That is not the
 * same question as "does this line read as a requirement", which is a human
 * read and stays one:
 *
 *   · it MISSES any assertion built on a verb not in the list. "Your employer
 *     appears on the IND list" walked through until `appears` was added, and
 *     `^you` could not see the possessive "Your" at all — both fixed here,
 *     neither provably the last of its kind.
 *   · it FLAGS a bare noun phrase that happens to contain one ("a contract
 *     that is countersigned"), which is a legitimate checklist line.
 *
 * One-sided on purpose: a flagged line costs a rewording, a missed one ships a
 * claim about a person nobody asked. The guarantee this file actually carries
 * is narrower than any name for it, and it is the teeth test below — the exact
 * sentences a person read on the live screens do not come back.
 */
const flaggedAsAssertion = (text: string): boolean => {
  const clause = mainClause(text);
  if (REQUIREMENT.test(clause)) return false;
  // A clause whose subject IS the reader is a claim about them by
  // construction: "You move in a manager role" says they do, under a heading
  // saying we never asked. The possessive counts — "Your employer is on the
  // list" is as much a claim about their situation as "You are".
  return ASSERTS.test(clause) || /^your?\b/i.test(clause);
};

describe("a precondition is linted for the assertion voice — a closed list, not a parser", () => {
  it("no line under \"Also required\" uses an assertion verb we have caught before", () => {
    const offenders: string[] = [];
    for (const route of routes())
      for (const line of requirementsOf(route))
        if (flaggedAsAssertion(line)) offenders.push(`${route.id}: "${line}"`);
    expect(offenders).toEqual([]);
  });

  it("the lint has teeth: the exact sentences a person read on the live screens fail it", () => {
    // These are the guarantee. What else the lint catches is a bonus; what it
    // misses is why a human still reads the list.
    for (const line of [
      "Your employer is on the Dutch immigration service's (IND) list of recognised sponsors",
      "The salary matches what the job normally pays — the Dutch immigration service judges this",
      "France's ministry of the economy recognises the employer as innovative",
      "The transfer lasts more than 90 days, in a manager, specialist or trainee role",
      "The group actually trades — not a shell company",
      "You move in a manager, specialist or trainee role",
      // Walked straight through the lint until this round (2026-09-07): an
      // assertion verb outside the list, and a subject the `^you` rule could
      // not see because the reader is there in the possessive.
      "Your employer appears on the IND list",
    ])
      expect(flaggedAsAssertion(line), line).toBe(true);
  });

  it("bare noun phrases stay legal — they already read as checklist items", () => {
    for (const line of [
      "An employment contract of at least six months",
      "Three months with the group before the move",
      "A signed hosting agreement with a recognised research institution",
      "Enough German for the job itself — how much depends on the work",
      "If your profession is regulated (health, law and similar), the professional licence must already be in hand",
    ])
      expect(flaggedAsAssertion(line), line).toBe(false);
  });

  it("every route still says what else it asks of the reader", () => {
    // The voice changed; the substance did not. A route that listed
    // requirements before still lists them.
    for (const id of ["nl-hsm-under30", "de-ict-card", "fr-talent-innovante", "es-highly-qualified"])
      expect(requirementsOf(routeOf(id)).length, id).toBeGreaterThan(0);
  });
});

/**
 * `preconditions` was doing two jobs, and the header lied about one of them:
 * lines that say the reader may qualify for LESS were rendered as things
 * demanded of them.
 */
describe("a statement in the reader's favour is never a requirement", () => {
  const MOVED: Array<[string, RegExp]> = [
    ["nl-hsm-30plus", /orientation year/i],
    ["nl-hsm-under30", /orientation year/i],
    ["de-experienced-worker", /collective/i],
    ["es-blue-card", /shortage occupation/i],
  ];

  it("none of them appears under \"Also required\" any more", () => {
    for (const [id, what] of MOVED)
      expect(requirementsOf(routeOf(id)).join(" · "), id).not.toMatch(what);
  });

  it("each one survives as a caveat, which fails nobody", () => {
    for (const [id, what] of MOVED)
      expect(caveatsOf(routeOf(id)).join(" · "), id).toMatch(what);
  });

  it("the Dutch Blue Card states the limb its OWN source states, not the one next door", () => {
    // The page's Blue Card section says nothing about an orientation year: the
    // sentence copied onto this route belongs to the highly skilled migrant
    // rows above it (snapshot read 2026-09-02).
    const caveats = caveatsOf(routeOf("nl-blue-card")).join(" · ");
    expect(caveats).not.toMatch(/orientation year/i);
    expect(caveats).toMatch(/change|extend/i);
  });

  it("a caveat carries its quote, or an attributable reason it has none", () => {
    const DATED = /^\d{4}-\d{2}-\d{2}$/;
    for (const route of routes())
      for (const s of routeStatements(route)) {
        const where = `${route.id}:${s.id}`;
        // No kind to exempt: what is ours is a `route.readings` entry now, a
        // construct with nowhere to put a source at all, so a label can no
        // longer launder a borrowed quote (review 2026-09-07).
        if (s.source) {
          expect(s.source.quote.length, where).toBeGreaterThan(4);
          expect(s.source.retrieved_at, where).toMatch(DATED);
          expect(s.unsourced, where).toBeUndefined();
        } else {
          // Never an invented quote — and never a reason written freehand: the
          // absence is a decision a gate can read and a date a human can age
          // (review 2026-09-07). Prose may accompany it; it may not replace it.
          expect(s.unsourced?.reason, where).toBeDefined();
          expect(s.unsourced!.checked_at, where).toMatch(DATED);
        }
      }
  });

  it("the fixed set of reasons is one list, not three copies of one", () => {
    // The schema gates the dataset, the type gates the code, and the watch
    // says one of these words about a PDF it found no text in. Three spellings
    // of one fact is three facts to the next reader (review 2026-09-07, S2).
    const schema = JSON.parse(readFileSync(new URL("../schema/ruleset.schema.json", import.meta.url), "utf8"));
    expect(schema.$defs.unsourcedReason.properties.reason.enum).toEqual([...UNSOURCED_REASONS]);
  });

  it("no reason a statement gives for having no quote is one we invented", () => {
    // The point of an enumeration is that nobody can extend it by writing
    // something. If a new case genuinely occurs, the schema names it first.
    for (const route of routes())
      for (const s of routeStatements(route))
        if (s.unsourced)
          expect(UNSOURCED_REASONS as readonly string[], `${route.id}:${s.id}`)
            .toContain(s.unsourced.reason);
  });
});
