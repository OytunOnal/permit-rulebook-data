import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  deriveBands, evaluate, fieldOptions, forEachCriterion, provenancedValuesOf, routeStatements,
} from "../src/engine.js";
import { quotedWithoutProvenance, renderableTexts } from "../src/prose.js";
import { validateDataset } from "../src/validate.js";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "../src/watch/core.js";
import type { Criterion, Dataset, FieldDef, Profile, Route } from "../src/types.js";

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
 * The measurement that produced the slice: 45 criterion notes shipped, 39 of
 * them containing a quotation mark, none carrying a source URL or a read date.
 * The schema typed `note` as a bare string, so provenance was impossible there
 * BY CONSTRUCTION — and unsourced prose had already turned out three times in
 * two days to be doing a rule's job.
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
    expect(paths.some((p) => p.includes("nl-hsm-under30") && p.includes("precondition"))).toBe(true);
    expect(paths.some((p) => p.includes("nl-orientation-year") && p.includes("statements"))).toBe(true);
    expect(paths.some((p) => p.includes("notices/"))).toBe(true);
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

  it("no criterion carries editorial prose that quotes anybody", () => {
    for (const { route, criterion } of allCriteria())
      if (criterion.note)
        expect(criterion.note, `${route}: ${criterion.note}`).not.toMatch(/["“”„«»]/);
  });
});

describe("s5e — what is ours is marked as ours", () => {
  const modelling = () =>
    routes().flatMap((r) => routeStatements(r).filter((s) => s.kind === "modelling").map((s) => ({ route: r.id, s })));

  it("our own commentary became a statement of its own kind, and the number is reported", () => {
    expect(modelling().length).toBeGreaterThan(0);
  });

  it("a modelling statement never claims a source — that is the whole point of it", () => {
    for (const { route, s } of modelling()) {
      expect(s.source, `${route}:${s.id}`).toBeUndefined();
      expect(s.unsourced, `${route}:${s.id}`).toBeUndefined();
    }
  });

  it("the schema refuses a modelling statement that borrows a quote", () => {
    const ds = clone();
    const route = ds.countries.flatMap((c) => c.routes).find((r) => r.id === "nl-hsm-under30")!;
    route.statements = [
      ...(route.statements ?? []),
      {
        id: "borrowed-quote", kind: "modelling", text: "Ours, with somebody else's evidence.",
        source: { source_url: "https://ind.nl/en", quote: "not ours to claim", retrieved_at: "2026-09-07" },
      },
    ];
    expect(validateDataset(ds).ok).toBe(false);
  });

  it("a precondition or caveat still has to carry a quote or an attributable reason it has none", () => {
    for (const route of routes())
      for (const s of routeStatements(route)) {
        if (s.kind === "modelling") continue;
        expect(Boolean(s.source) !== Boolean(s.unsourced), `${route.id}:${s.id}`).toBe(true);
      }
  });
});

describe("s5e — the gate bites, and rewording is not how you silence it", () => {
  const messageFor = (ds: Dataset): string =>
    validateDataset(ds).errors.map((e) => `${e.path} ${e.message}`).join("\n");

  const quoted = 'The service says "you must have a job offer" before you apply.';

  it("a criterion note with a quotation mark and no source fails the build", () => {
    const ds = clone();
    ds.countries[0].routes[0].criteria[0].note = quoted;
    const result = validateDataset(ds);
    expect(result.ok).toBe(false);
    // The message says the two honest options, in words a curator can act on.
    expect(messageFor(ds)).toMatch(/source_url/);
    expect(messageFor(ds)).toMatch(/retrieved_at/);
    expect(messageFor(ds)).toMatch(/modelling/);
  });

  it("the same sentence passes the moment it is attributed to us", () => {
    const ds = clone();
    const route = ds.countries[0].routes[0];
    route.statements = [
      ...(route.statements ?? []),
      { id: "ours-for-the-test", kind: "modelling", text: quoted },
    ];
    expect(validateDataset(ds).ok, messageFor(ds)).toBe(true);
  });

  it("it also bites in every other slot a card renders from, not just the one it was written for", () => {
    // Written at the symptom level: a curator who moves the sentence to a
    // different field does not escape it. Each of these is a place text
    // reaches the screen from.
    const mutations: Array<[string, (ds: Dataset) => void]> = [
      ["route summary", (ds) => { ds.countries[0].routes[0].summary = quoted; }],
      ["precondition", (ds) => { ds.countries[0].routes[0].preconditions = [quoted]; }],
      ["statement text", (ds) => {
        const r = ds.countries[0].routes[0];
        r.statements = [...(r.statements ?? []), {
          id: "smuggled", kind: "caveat", text: quoted,
          unsourced: { reason: "unreachable", checked_at: "2026-09-07" },
        }];
      }],
      ["short_reason", (ds) => { ds.countries[0].routes[0].criteria[0].short_reason = quoted; }],
      ["notice body", (ds) => { ds.notices![0].body = quoted; }],
      ["a criterion nested inside a disjunction", (ds) => {
        for (const country of ds.countries)
          for (const route of country.routes)
            forEachCriterion(route.criteria, (c) => { if (c.op === "any") c.paths[0].criteria[0].note = quoted; });
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
    c.note = undefined;
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
      ...criteriaOf(route).flatMap((c) => (c.note ? [c.note] : [])),
      ...routeStatements(route).filter((s) => s.kind === "modelling").map((s) => s.text),
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
    ]);
  });

  it("every verdict the engine reaches is the verdict it reached before", () => {
    // 400 seeded profiles, digested. A criterion that changed meaning, a
    // threshold that moved or a route that started failing somebody would all
    // change this hex; moving prose cannot.
    function lcg(seed: number) {
      let s = seed >>> 0;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    }
    const optionValues = (def: FieldDef): string[] =>
      def.type === "money_band"
        ? deriveBands(dataset, def.id).map((b) => b.id)
        : fieldOptions(dataset, def.id).map((o) => o.value);
    const rand = lcg(90210);
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      const p: Profile = {};
      for (const def of dataset.fields)
        if (rand() < 0.75) {
          const vals = optionValues(def);
          p[def.id] = vals[Math.floor(rand() * vals.length)];
        }
      for (const r of evaluate(dataset, p))
        lines.push([r.route.id, r.status, r.hard_fail ? 1 : 0, r.gap_max ?? "", r.gap_points ?? "", r.points ? r.points.scored : ""].join("|"));
    }
    expect(createHash("sha256").update(lines.join("\n")).digest("hex"))
      .toBe("7985e43ce43636135a79fd5b31a1544c01a54e80c9eb27a9535af779c5383ec5");
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
    expect(human.length).toBeGreaterThan(0);
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
