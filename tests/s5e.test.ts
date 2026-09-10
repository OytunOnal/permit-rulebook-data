import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  deriveBands, evaluate, fieldOptions, forEachCriterion, provenancedValuesOf, routeReadings,
  routeStatements,
} from "../src/engine.js";
import { proseProvenance, quotedWithoutProvenance, renderableTexts } from "../src/prose.js";
import { validateDataset } from "../src/validate.js";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "../src/watch/core.js";
import type { Criterion, Dataset, FieldDef, Profile, Route, RouteReading, RouteResult } from "../src/types.js";

/**
 * The dataset without one option of the `experience` ladder — the rules as
 * they stood before it was added, over the same people.
 */
function withoutExperienceOption(ds: Dataset, value: string): Dataset {
  const before = structuredClone(ds) as Dataset;
  const def = before.fields.find((f) => f.id === "experience")!;
  def.options = (def.options ?? []).filter((o) => o.value !== value);
  for (const o of def.options) if (o.implies) o.implies = o.implies.filter((v) => v !== value);
  for (const country of before.countries)
    for (const route of country.routes)
      forEachCriterion(route.criteria, (c) => {
        if (c.op === "in" && c.field === "experience") c.values = c.values.filter((v) => v !== value);
        if (c.op === "points")
          for (const item of c.table.items) if (item.field === "experience") delete item.points[value];
      });
  return before;
}

const readJson = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8").replace(/^﻿/, ""));

const dataset = readJson("../data/dataset.json") as Dataset;
const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const state = readJson("../watch/state.json") as WatchState;

const routes = (): Route[] => dataset.countries.flatMap((c) => c.routes);
const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;

/** A fresh deep copy, so a mutation test can break the dataset without leaking. */
const clone = (): Dataset => structuredClone(dataset);

const criteriaOf = (route: Route): Criterion[] => {
  const out: Criterion[] = [];
  forEachCriterion(route.criteria, (c) => out.push(c));
  return out;
};

const allCriteria = (): { route: string; criterion: Criterion }[] =>
  routes().flatMap((r) => criteriaOf(r).map((criterion) => ({ route: r.id, criterion })));

/**
 * s5e — "Every sentence carries its source, not only every number".
 *
 * The measurement that produced the slice: criterion notes shipped with a
 * quotation mark in most of them and a source URL or a read date in none. The
 * schema typed `note` as a bare string, so provenance was impossible there BY
 * CONSTRUCTION — and unsourced prose had already turned out three times in two
 * days to be doing a rule's job.
 *
 * ON THE COUNT, because two numbers are in circulation. The approved scenario
 * says **46 notes, 39 of them quoting**. Re-running the audit against the
 * dataset as it stood at the start of the slice gives **45**. The scenario's
 * number has not been reproduced and no note was deleted before the audit ran,
 * so one of the two counts is simply wrong and this file does not pretend to
 * know which; 45 is the number this suite measured and the one it reports. The
 * discrepancy is one note either way and it changes nothing about the slice —
 * it is written down rather than quietly resolved in favour of whichever is
 * more convenient (review 2026-09-07).
 *
 * Where those sentences went is pinned below, and printed as a measurement by
 * `npm run check` so it is a number a person reads and not only a test that
 * passes.
 */

describe("s5e — no sentence a card can render quotes an authority without provenance", () => {
  it("holds over the whole dataset, at the symptom level", () => {
    // Not "the field is present": every string the dataset ships that a card
    // can put on a screen is walked, and any quotation mark in one has to have
    // a source URL and a read date beside it — or be attributed to us.
    const offenders = quotedWithoutProvenance(dataset);
    expect(offenders.map((o) => `${o.path}: ${o.text.slice(0, 60)}`)).toEqual([]);
  });

  it("the walk actually reaches the places a card renders from", () => {
    const paths = renderableTexts(dataset).map((t) => t.path);
    // A route's own words, the conditions it checks, the statements beside
    // them, and the dataset-level notices. A slot missing here is a slot the
    // gate cannot see.
    expect(paths.some((p) => p.includes("nl-hsm-under30") && p.endsWith("/name"))).toBe(true);
    // The bare `preconditions` slot is walked too (s5f kinds it, and
    // tests/s5f.test.ts mutates it to prove the gate bites); the shipped
    // dataset keeps its preconditions where they can carry a quote.
    expect(paths.some((p) => p.includes("nl-hsm-under30") && p.includes("statements"))).toBe(true);
    expect(paths.some((p) => p.includes("nl-orientation-year") && p.includes("statements"))).toBe(true);
    expect(paths.some((p) => p.includes("nl-orientation-year") && p.includes("readings"))).toBe(true);
    expect(paths.some((p) => p.includes("notices/"))).toBe(true);
    // And every one of them declares which of the three kinds it is — the walk
    // has no "unknown" bucket, because the gate reads the declaration.
    for (const t of renderableTexts(dataset))
      expect(["authority", "ours", "label"], t.path).toContain(t.kind);
    // Nested inside a disjunction, which is where half the criteria live.
    expect(paths.some((p) => /criteria\/\d+\/paths\/\d+\/criteria\/\d+/.test(p))).toBe(true);
  });

  it("every condition that quoted an authority now carries that authority's words, dated", () => {
    const sourced = allCriteria().filter(({ criterion }) => criterion.source);
    // 39 notes quoted something; the ones that survive as evidence are here.
    expect(sourced.length).toBeGreaterThanOrEqual(25);
    for (const { route, criterion } of sourced) {
      const s = criterion.source!;
      expect(s.source_url, route).toMatch(/^https:\/\//);
      expect(s.quote.length, route).toBeGreaterThan(4);
      expect(s.retrieved_at, route).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A quote is what the page says, not what we say about it: no ellipsis
      // stitching two sentences into one that was never printed.
      expect(s.quote, `${route}: ${s.quote}`).not.toMatch(/\.\.\.|…/);
    }
  });

  it("a criterion has nowhere left to put editorial prose", () => {
    // `note` was the one renderable slot that declared no kind — neither the
    // authority's words nor ours — and the gate could only see it when it
    // happened to contain a quotation mark. "Recognised by the state where it
    // was acquired — German recognition not required (§ 6 BeschV)" had none,
    // and passed. The slot is gone rather than policed (review 2026-09-07).
    for (const { route, criterion } of allCriteria())
      expect(criterion, route).not.toHaveProperty("note");
    const ds = clone();
    (ds.countries[0].routes[0].criteria[0] as unknown as Record<string, unknown>).note = "Anything at all.";
    expect(validateDataset(ds).ok, "a criterion note is still accepted").toBe(false);
  });
});

describe("s5e — what is ours is marked as ours", () => {
  const readings = () =>
    routes().flatMap((r) => routeReadings(r).map((s) => ({ route: r.id, s })));

  it("every sentence stands somewhere declared, and the split is pinned", () => {
    // Step 1 of the scenario asks for the number, not for "more than none" —
    // and asks that it be reported. The same three counts are printed by
    // `npm run check` (see cli-coverage), because a number only a test reads
    // is not reported to anybody (review 2026-09-07).
    //
    // It is more than the 45 notes went to: attaching an authority's words to
    // an `eq` criterion became possible in this slice, so conditions that
    // never carried a note carry a source now.
    expect(proseProvenance(dataset)).toEqual({
      // Sentences an authority is shown to have said: a criterion's own
      // source, plus a statement standing on a quote.
      // s5f moved 37 bare preconditions in here: a line saying what an
      // authority demands of an applicant is the authority's position, and it
      // now carries the authority's words or is declared ours below. Two more
      // arrived on 2026-09-08 with the intra-corporate-transferee caveat on
      // both highly-skilled-migrant routes. Fifteen more arrived with s7: the
      // provisional residence permit each of the six Dutch pages states, and
      // the nine carve-outs beside them — three Turkish, six for the ten
      // passports the IND exempts from that permit. A carve-out is a claim
      // about the law in the reader's favour, so it is counted where the
      // authority's other sentences are counted. One more arrived with s8: the
      // sentence saying France does not open its intra-corporate transfer card
      // to an Algerian passport, which stands on that fiche's own eligibility
      // line — a criterion that CLOSES a route is a claim about the law like
      // any other, and it does not ship without the authority's words.
      // Forty-three more arrived with s9: the conditions of the five routes
      // this product states and does not score. A route nothing is asked about
      // is nothing BUT the authority's sentences, so every limb of it is here.
      with_provenance: 110 + 44,
      // Ours, declared as ours and shown to the reader as ours: 13 route
      // readings, plus the 28 scope-statement reasons s6 authored — one per route,
      // our own words about our own interview, printed as the page's scope
      // statement — plus, since 2026-09-08, the two sentences a contradiction
      // shows and the three doors a money question offers a reader none of its
      // amounts fits. All five are read by a person and none is quoted from
      // anyone, so they are counted here. The five that arrived with s9 are the
      // sentence each unscored route carries saying why we do not score it.
      ours: (8 + 5) + (23 + 5) + 2 + 3,
      // Standing on a declared, dated reason no quote could be found — the one
      // exception, and an attributable decision rather than a blank. It is
      // zero: the last one was the es-blue-card shortage-occupation caveat,
      // declared unsourced because Orden PJC/44/2026 is a scanned image, and
      // the UGE salary PDF turned out to state the same conditions in words
      // (2026-09-07). An exception nobody is using is the healthy state for
      // it; the slot stays, and the gate that enforces it stays.
      declared_unsourced: 0,
    });
  });

  it("our own words live in their own construct, not inside the authority's", () => {
    // `modelling` was a third RouteStatement kind until this review. The
    // glossary defines a Route statement as something a SOURCE says about a
    // route, so a reading was an undeclared second exception to Provenance
    // living inside the construct built for the authority's words, told apart
    // from one only by a kind enum checked at nine sites across two repos.
    // Thirteen since s9: one on each of the five routes that are quoted and
    // not scored, saying in our words what no authority says — that the figure
    // is not published, that the search is not ours to see.
    expect(readings().length).toBe(8 + 5);
    for (const route of routes())
      for (const s of routeStatements(route))
        expect(["precondition", "caveat"], `${route.id}:${s.id}`).toContain(s.kind);
  });

  it("a reading has nowhere to put a source — that is the whole point of it", () => {
    for (const { route, s } of readings()) {
      // Not "is undefined": the schema refuses the key, so a reading cannot be
      // given borrowed evidence even by a curator who tries.
      expect(Object.keys(s).sort(), `${route}:${s.id}`).toEqual(["id", "text"]);
    }
  });

  it("the schema refuses a reading that borrows a quote", () => {
    const ds = clone();
    const route = ds.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-hsm-under30")!;
    route.readings = [
      ...(route.readings ?? []),
      {
        id: "borrowed-quote", text: "Ours, with somebody else's evidence.",
        source: { source_url: "https://ind.nl/en", quote: "not ours to claim", retrieved_at: "2026-09-07" },
      } as unknown as RouteReading,
    ];
    expect(validateDataset(ds).ok).toBe(false);
  });

  it("a statement still has to carry a quote or an attributable reason it has none", () => {
    for (const route of routes())
      for (const s of routeStatements(route))
        expect(Boolean(s.source) !== Boolean(s.unsourced), `${route.id}:${s.id}`).toBe(true);
  });
});

describe("s5e — the gate bites, and rewording is not how you silence it", () => {
  const messageFor = (ds: Dataset): string =>
    validateDataset(ds).errors.map((e) => `${e.path} ${e.message}`).join("\n");

  const quoted = 'The service says "you must have a job offer" before you apply.';

  /**
   * The sentence the old gate missed. It cites a statute, states what the law
   * does and does not require, carries no source — and contains no quotation
   * mark, so a check keyed on quotation marks read it as harmless prose and
   * let it ship. It is in the mutation set now, and it fails for the reason it
   * should: the slot it lands in declares itself the authority's position and
   * has no authority beside it.
   */
  const claimWithNoMarks =
    "Recognised by the state where it was acquired — German recognition not required (§ 6 BeschV).";

  const firstRoute = (ds: Dataset) => ds.countries[0].routes[0];

  it("a sentence in quotation marks with no source fails the build, wherever it is put", () => {
    const ds = clone();
    const r = firstRoute(ds);
    r.statements = [...(r.statements ?? []), {
      id: "smuggled", kind: "caveat", text: quoted,
      unsourced: { reason: "unreachable", checked_at: "2026-09-07" },
    }];
    expect(validateDataset(ds).ok).toBe(false);
    // The message says the honest options, in words a curator can act on —
    // and never leaves "delete the quotation marks" as one of them.
    expect(messageFor(ds)).toMatch(/source_url/);
    expect(messageFor(ds)).toMatch(/retrieved_at/);
    expect(messageFor(ds)).toMatch(/readings/);
    expect(messageFor(ds)).toMatch(/Deleting the quotation marks is not one of the options/);
  });

  it("the § 6 BeschV sentence fails too — no quotation mark anywhere in it", () => {
    // Three slots, three failures. This is the case the re-keying was done
    // for: the old gate passed all three, because it only ever looked for
    // punctuation.
    //
    // WHERE IT STILL PASSES, stated rather than left to be discovered: as a
    // notice body, or as a caveat carrying a declared and dated `unsourced`
    // reason. Both of those DO declare where they stand — one on a quote, one
    // on a decision somebody made and the card prints — and no gate here can
    // judge whether a paraphrase is faithful to the quote beside it. That is a
    // reader's job, and the card shows both so a reader can do it.
    const mutations: Array<[string, (ds: Dataset) => void]> = [
      ["a caveat with neither a source nor a declared absence", (ds) => {
        const r = firstRoute(ds);
        r.statements = [...(r.statements ?? []), { id: "beschv", kind: "caveat", text: claimWithNoMarks }];
      }],
      ["a precondition statement with neither", (ds) => {
        const r = firstRoute(ds);
        r.statements = [...(r.statements ?? []), { id: "beschv", kind: "precondition", text: claimWithNoMarks }];
      }],
      ["the criterion note it actually shipped in", (ds) => {
        (firstRoute(ds).criteria[0] as unknown as Record<string, unknown>).note = claimWithNoMarks;
      }],
    ];
    for (const [where, mutate] of mutations) {
      const ds = clone();
      mutate(ds);
      expect(validateDataset(ds).ok, `${where} slipped past the gate`).toBe(false);
    }
  });

  it("the same sentence passes the moment it is declared ours, or given the statute it cites", () => {
    const asOurs = clone();
    const r = asOurs.countries[0].routes[0];
    r.readings = [...(r.readings ?? []), { id: "ours-for-the-test", text: claimWithNoMarks }];
    expect(validateDataset(asOurs).ok, messageFor(asOurs)).toBe(true);

    const asSourced = clone();
    const r2 = asSourced.countries[0].routes[0];
    r2.statements = [...(r2.statements ?? []), {
      id: "beschv", kind: "caveat", text: claimWithNoMarks,
      source: {
        source_url: "https://www.buzer.de/6_BeschV.htm",
        quote: "im Ausbildungsstaat staatlich anerkannt",
        retrieved_at: "2026-09-07",
        legal_basis: "§ 6 Abs. 1 Satz 1 Nr. 3 Buchst. a BeschV",
      },
    }];
    expect(validateDataset(asSourced).ok, messageFor(asSourced)).toBe(true);

    // And a quoted sentence still passes the moment it is ours: the escape is
    // the declaration, not the punctuation.
    const quotedAsOurs = clone();
    const r3 = quotedAsOurs.countries[0].routes[0];
    r3.readings = [...(r3.readings ?? []), { id: "quoted-ours", text: quoted }];
    expect(validateDataset(quotedAsOurs).ok, messageFor(quotedAsOurs)).toBe(true);
  });

  it("it also bites in every other slot a card renders from, not just the one it was written for", () => {
    // Written over the text, not the fields: a curator who moves the sentence
    // to a different slot does not escape it. Each of these is a place text
    // reaches the screen from.
    const mutations: Array<[string, (ds: Dataset) => void]> = [
      ["route summary", (ds) => { firstRoute(ds).summary = quoted; }],
      ["precondition", (ds) => { firstRoute(ds).preconditions = [quoted]; }],
      ["statement text", (ds) => {
        const r = firstRoute(ds);
        r.statements = [...(r.statements ?? []), {
          id: "smuggled", kind: "caveat", text: quoted,
          unsourced: { reason: "unreachable", checked_at: "2026-09-07" },
        }];
      }],
      ["short_reason", (ds) => { firstRoute(ds).criteria[0].short_reason = quoted; }],
      ["threshold_label", (ds) => {
        forEachCriterion(firstRoute(ds).criteria, (c) => { if (c.op === "gte") c.threshold_label = quoted; });
      }],
      ["legal_basis", (ds) => {
        forEachCriterion(firstRoute(ds).criteria, (c) => { if (c.op === "gte") c.threshold.legal_basis = quoted; });
      }],
      ["a field label", (ds) => { ds.fields[0].label = quoted; }],
      ["an option label", (ds) => { ds.fields[0].options![0].label = quoted; }],
      ["notice body", (ds) => { ds.notices![0].body = quoted; }],
      ["the prose beside a declared absence", (ds) => {
        // The mutation builds the slot it tests. No statement in the dataset
        // declares an absence any more — the last one, the es-blue-card
        // shortage-occupation caveat, got its quote on 2026-09-07 — and a
        // mutation that finds nothing to poison is a test that passes for the
        // wrong reason. The slot is still in the schema, so the gate still has
        // to reach it the day somebody uses it again.
        const r = firstRoute(ds);
        r.statements = [...(r.statements ?? []), {
          id: "absence-with-a-note", kind: "caveat", text: "Something the authority is said to require.",
          unsourced: { reason: "unreachable", checked_at: "2026-09-07", note: quoted },
        }];
      }],
      ["a disjunction path label", (ds) => {
        for (const country of ds.countries)
          for (const route of country.routes)
            forEachCriterion(route.criteria, (c) => { if (c.op === "any") c.paths[0].label = quoted; });
      }],
    ];
    for (const [where, mutate] of mutations) {
      const ds = clone();
      mutate(ds);
      expect(validateDataset(ds).ok, `${where} slipped past the gate`).toBe(false);
    }
  });

  it("attaching a source to the criterion is the other honest option", () => {
    const ds = clone();
    const c = ds.countries[0].routes[0].criteria[0];
    c.source = {
      source_url: "https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Arbeit/Fachkraft/fachkraft-node.html",
      quote: "you must have a job offer",
      retrieved_at: "2026-09-07",
    };
    // The quote itself is never the offender: it IS the provenance.
    expect(quotedWithoutProvenance(ds)).toEqual([]);
  });
});

describe("s5e — the euro figure", () => {
  it("no sentence on the Dutch under-30 route asserts an amount without a quote behind it", () => {
    // "When changing employer after turning 30, the €5,942.00 amount applies"
    // shipped as an editorial note: a euro figure with no quote and no source,
    // which is exactly what this product exists not to do. Either the Dutch
    // immigration service's own words carry it, or it is gone.
    const route = routeOf("nl-hsm-under30");
    const prose = [
      ...(route.preconditions ?? []),
      ...routeReadings(route).map((r) => r.text),
    ];
    for (const line of prose) expect(line, line).not.toMatch(/5[.,]?942|€\s?5/);

    const carriers = routeStatements(route).filter((s) => /5,942/.test(s.text));
    for (const s of carriers) {
      expect(s.source, `${s.id} states an amount`).toBeDefined();
      expect(s.source!.source_url).toMatch(/^https:\/\/ind\.nl\//);
      expect(s.source!.quote).toMatch(/5,942/);
      expect(s.source!.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("s5e — this slice moves prose, not numbers", () => {
  /** Every number the dataset asserts, with the route that asserts it. */
  const valueSet = (): string[] => {
    const out: string[] = [];
    for (const country of dataset.countries)
      for (const route of country.routes)
        forEachCriterion(route.criteria, (c) => {
          for (const p of provenancedValuesOf(c)) {
            if (p.amount !== undefined) out.push(`${route.id}|${p.amount}`);
            else if ("value" in p.value && typeof (p.value as { value?: number }).value === "number")
              out.push(`${route.id}|pts|${(p.value as { value: number }).value}`);
          }
        });
    return out.sort();
  };

  it("the value set is byte-identical to the one that shipped before this slice", () => {
    expect(valueSet()).toEqual([
      "de-blue-card-general|50700",
      "de-blue-card-shortage|45934.2",
      "de-chancenkarte|1091",
      "de-chancenkarte|pts|6",
      "de-experienced-worker|45630",
      "es-blue-card|33085.09",
      "es-blue-card|41356.36",
      "es-highly-qualified|41356.36",
      "fr-ict|1867.02",
      "fr-talent-blue-card|59373",
      "fr-talent-innovante|39582",
      "fr-talent-mission|39582",
      "fr-talent-qualifie|39582",
      "nl-blue-card|4754",
      "nl-blue-card|5942",
      "nl-hsm-30plus|3122",
      "nl-hsm-30plus|5942",
      "nl-hsm-under30|3122",
      "nl-hsm-under30|4357",
      "nl-ict|4357",
      "nl-ict|5942",
      "nl-researcher|1635.9",
    ]);
  });

  it("no route appeared or disappeared", () => {
    expect(routes().map((r) => r.id).sort()).toEqual([
      "de-blue-card-general", "de-blue-card-shortage", "de-chancenkarte", "de-experienced-worker",
      "de-ict-card", "de-researcher", "de-skilled-academic", "de-skilled-vocational",
      "es-blue-card", "es-highly-qualified", "es-ict", "es-researcher",
      "fr-ict", "fr-talent-blue-card", "fr-talent-innovante", "fr-talent-mission", "fr-talent-qualifie",
      "nl-blue-card", "nl-hsm-30plus", "nl-hsm-under30", "nl-ict", "nl-orientation-year", "nl-researcher",
      // The five s9 added — quoted and dated, scored by nothing.
      "de-selbstaendige-taetigkeit", "es-cuenta-ajena", "es-teletrabajo", "fr-salarie", "nl-gvva",
    ].sort());
  });

  /** The 400 seeded profiles this pin is computed over. */
  function seededProfiles(): Profile[] {
    function lcg(seed: number) {
      let s = seed >>> 0;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    }
    const optionValues = (def: FieldDef): string[] =>
      def.type === "money_band"
        ? deriveBands(dataset, def.id).map((b) => b.id)
        : fieldOptions(dataset, def.id).map((o) => o.value);
    const rand = lcg(90210);
    const profiles: Profile[] = [];
    for (let i = 0; i < 400; i++) {
      const p: Profile = {};
      for (const def of dataset.fields)
        if (rand() < 0.75) {
          const vals = optionValues(def);
          p[def.id] = vals[Math.floor(rand() * vals.length)];
        }
      profiles.push(p);
    }
    return profiles;
  }

  const rowOf = (r: RouteResult): string =>
    [r.route.id, r.status, r.hard_fail ? 1 : 0, r.gap_max ?? "", r.gap_points ?? "", r.points ? r.points.scored : ""].join("|");

  it("every verdict the engine reaches is the verdict it reached before", () => {
    // 400 seeded profiles, digested. A criterion that changed meaning, a
    // threshold that moved or a route that started failing somebody would all
    // change this hex; moving prose cannot. What it CANNOT say is who moved
    // and which way, which is the next test's job.
    const lines = seededProfiles().flatMap((p) => evaluate(dataset, p).map(rowOf));
    expect(createHash("sha256").update(lines.join("\n")).digest("hex"))
      .toBe("6ee710eaf7fede018c94b2b3714aa274c29d80d9509779bb7187315fe976e59d");
  });

  it("and when it moves, the differential holds the population fixed", () => {
    /*
     * What the digest's own comment used to claim — "the seeded profiles draw
     * from four options where they drew from three, twenty-six of the 400
     * moved" — was not a differential at all. Adding an option to the ladder
     * changes what the generator DRAWS, so that comparison put 400 people
     * against 400 different people: different profiles, not different rules,
     * and the count is noise. Neither 26 nor the commit message's 27 is
     * reproducible by any method; the regenerated comparison moves 89 profiles
     * and 100 rows, almost all of it the Chancenkarte scoring a reshuffled
     * answer (review 2026-09-07, H3).
     *
     * Same people, two rulesets, split by what they answered — because the new
     * option is not answerable under the old rules, and comparing it against a
     * dataset that has never heard of it proves nothing:
     *
     *   - 318 profiles answered an option the old ladder already had. Under
     *     the old rules and the new ones, EVERY route gives them the same row.
     *     That is decision 1's "every other route keeps its verdicts", with no
     *     route exempted.
     *   - 82 profiles answered the new `y3in7`. Their honest baseline is the
     *     same person answering `y2in5`, the rung below. 15 rows are better
     *     for them and none is worse: 7 on `es-highly-qualified` (decision 1)
     *     and 8 on `es-ict` (the verdict its own quote refuted).
     */
    const before = withoutExperienceOption(dataset, "y3in7");
    let unchangedProfiles = 0;
    let newAnswerProfiles = 0;
    const better: Record<string, number> = {};
    for (const p of seededProfiles()) {
      if (p.experience === "y3in7") {
        newAnswerProfiles++;
        const rung = new Map(evaluate(dataset, { ...p, experience: "y2in5" }).map((r) => [r.route.id, rowOf(r)]));
        for (const r of evaluate(dataset, p))
          if (rung.get(r.route.id) !== rowOf(r)) better[r.route.id] = (better[r.route.id] ?? 0) + 1;
      } else {
        unchangedProfiles++;
        const old = new Map(evaluate(before, p).map((r) => [r.route.id, rowOf(r)]));
        for (const r of evaluate(dataset, p))
          expect(rowOf(r), `${r.route.id} moved for a profile that answered ${String(p.experience)}`)
            .toBe(old.get(r.route.id));
      }
    }
    expect(unchangedProfiles).toBe(318);
    expect(newAnswerProfiles).toBe(82);
    expect(better).toEqual({ "es-highly-qualified": 7, "es-ict": 8 });
    // Every one of those 15 is toward the reader — the direction is proved
    // over 600 profiles and every route in tests/s5f.test.ts.
  });
});

describe("s5e — watch coverage holds both ways", () => {
  it("every newly attached source is watched, and no watch entry is orphaned", () => {
    const coverage = checkCoverage(dataset, watchlist);
    expect(coverage.missing_from_watchlist).toEqual([]);
    expect(coverage.orphan_watch_entries).toEqual([]);
  });

  it("every quote is reported as verified or as unverifiable — never silently", () => {
    const quotes = checkQuotes(dataset, watchlist, state);
    expect(quotes.missing.map((m) => `${m.where}: ${m.quote.slice(0, 50)}`)).toEqual([]);
    expect(quotes.verified).toBeGreaterThan(30);
    for (const u of quotes.unverifiable) expect(u.reason.length).toBeGreaterThan(0);
  });

  it("the quotes no machine here can check are written down for a human, one by one", () => {
    // The cost the scenario named before it was paid. The checklist is not
    // green until it exists and its size is known — a human may decide some of
    // these should be deleted rather than verified, and that needs a list.
    const path = new URL("../data/verify-s5e.md", import.meta.url);
    expect(existsSync(path), "data/verify-s5e.md").toBe(true);
    // Read as one line: a quote wrapped across a markdown line is still the
    // sentence a person will look for.
    const checklist = readFileSync(path, "utf8").replace(/\s+/g, " ");
    const quotes = checkQuotes(dataset, watchlist, state);
    const human = quotes.unverifiable.filter((u) => !u.where.startsWith("class:"));
    // Empty since s5f: the six PDF quotes this list was written for are read
    // by the `pdf-text` strategy now. The rule the list encodes has not been
    // relaxed — every quote a machine cannot check must still be written down,
    // one by one, with its page and its sentence — so the loop stays and the
    // file must say, in the open, that the machine closed it.
    expect(checklist).toContain("CLOSED BY THE MACHINE");
    for (const u of human) {
      // The route it belongs to, the page to open, and the exact sentence to
      // look for — a checklist that only named routes would leave a person
      // reading a PDF wondering which line they were meant to check.
      expect(checklist, `${u.where}: route not named in verify-s5e.md`).toContain(u.where);
      expect(checklist, `${u.where}: source page not named`).toContain(u.source_url);
      expect(checklist, `${u.where}: the sentence itself is not written down`)
        .toContain(u.quote.replace(/\s+/g, " "));
    }
  });
});
