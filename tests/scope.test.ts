import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { proseProvenance, renderableTexts } from "../src/prose.js";
import { scopeWords, statedNotAsked, SCOPE_VALUES } from "../src/scope.js";
import {
  excludedLimbs, limbIdsOf, readExclusions, routesInProse, scopeDisagreesWithExclusions,
  twinDisagreesWithProse,
} from "../src/exclusions.js";
import {
  LANGUAGE_NAMES, QUOTE_LANGUAGES, quoteLanguage, sourceUrls, unmappedSources,
} from "../src/lang.js";
import type { Dataset, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const routes = (): Route[] => ds.countries.flatMap((c) => c.routes);
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;
const exclusions = readExclusions();

/**
 * s6 decision 3 — every route declares its Scope statement, in plain words.
 *
 * The value a stranger reads is authored by a person and never derived here:
 * the first cut of this file computed the value from the route's own statements
 * and then asserted the dataset matched, which tests the derivation and not the
 * curation (Standards review, 2026-09-07). What a test may hold is consistency
 * — a page that names limbs it does not ask cannot also claim it asks
 * everything — and agreement with `data/exclusions.md`, in both directions.
 */
describe("s6 — every route declares what the checker asks of it", () => {
  it("carries exactly one value, from the three declared words, with its reason", () => {
    for (const r of routes()) {
      expect(r.scope, r.id).toBeDefined();
      expect(SCOPE_VALUES, r.id).toContain(r.scope.value);
      expect(r.scope.reason.trim().length, r.id).toBeGreaterThan(40);
      expect(r.scope.reason, r.id).toMatch(/\.$/);
    }
    expect(routes().length).toBe(23);
    // Authored for the route it is on: two Blue Card routes shipped a
    // byte-identical sentence, which is a template, not a reading.
    const reasons = routes().map((r) => r.scope.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("absence is not allowed: a route with no scope statement fails validation", () => {
    const noScope = clone();
    delete (noScope.countries[0].routes[0] as Partial<Route>).scope;
    expect(validateDataset(noScope).ok).toBe(false);
    const badValue = clone();
    (badValue.countries[0].routes[0].scope as { value: string }).value = "fully-modelled";
    expect(validateDataset(badValue).ok).toBe(false);
    const noLimbs = clone();
    delete (noLimbs.countries[0].routes[0].scope as Partial<Route["scope"]>).not_asked;
    expect(validateDataset(noLimbs).ok).toBe(false);
    const noReason = clone();
    noReason.countries[0].routes[0].scope.reason = "";
    expect(validateDataset(noReason).ok).toBe(false);
  });

  it("the words are plain: no pipeline vocabulary reaches the reader", () => {
    const said = [
      ...SCOPE_VALUES.map((v) => scopeWords(v)),
      ...routes().map((r) => r.scope.reason),
    ].join(" ").toLowerCase();
    for (const word of ["modelled", "modeled", "modelling", "criterion", "criteria", "scored", "pipeline", "coverage"])
      expect(said, word).not.toContain(word);
    // A reason is our own words about our own interview. It never puts an
    // authority in quotation marks in a slot nothing can check them against.
    for (const r of routes())
      expect(r.scope.reason, r.id).not.toMatch(/["“”„‟«»]/);
  });

  /**
   * INVARIANT 3, amended — the limbs the page names as not asked are the limbs
   * `data/exclusions.md` records, both ways, for every route the file names.
   */
  it("exclusions.md agrees with itself: the prose and the twin name the same routes", () => {
    expect(twinDisagreesWithProse(exclusions)).toEqual([]);
    // The file is the only place that says which routes it records; nothing
    // here restates the list.
    expect(routesInProse(exclusions).size).toBe(excludedLimbs(exclusions).size);
    expect(excludedLimbs(exclusions).size).toBeGreaterThanOrEqual(7);
  });

  it("every limb exclusions.md records is a limb the page names, and vice versa", () => {
    expect(scopeDisagreesWithExclusions(ds, exclusions)).toEqual([]);
  });

  it("a limb the file records and the page drops fails the build", () => {
    const dropped = clone();
    const es = dropped.countries.flatMap((c) => c.routes).find((r) => r.id === "es-blue-card")!;
    es.scope.not_asked = es.scope.not_asked.filter((id) => id !== "reduced-also-for-shortage-occupations");
    expect(scopeDisagreesWithExclusions(dropped, exclusions)).toContain(
      "es-blue-card: exclusions.md records \"reduced-also-for-shortage-occupations\" and the page never names it",
    );
  });

  it("a limb the page invents fails the build", () => {
    const invented = clone();
    const de = invented.countries[0].routes[0];
    de.scope.not_asked = [...de.scope.not_asked, "a-limb-nobody-wrote"];
    expect(scopeDisagreesWithExclusions(invented, exclusions)).toContain(
      `${de.id}: scope names "a-limb-nobody-wrote", which is neither a statement nor a reading of it`,
    );
  });

  it("a twin that names a route the prose does not fails the build", () => {
    const drifted = exclusions.replace("nl-ict: (none)", "nl-ict: (none)\nde-invented-route: (none)");
    expect(twinDisagreesWithProse(drifted)).toContain(
      "de-invented-route is in the twin and named nowhere in the prose",
    );
  });

  /** Consistency, not derivation: what a route may NOT say, given what it names. */
  it("a page that names limbs it does not ask cannot claim it asks everything", () => {
    for (const r of routes())
      if (r.scope.not_asked.length > 0)
        expect(r.scope.value, `${r.id} names ${r.scope.not_asked.length} limb(s) it does not ask`)
          .not.toBe("every-deciding-rule-asked");
  });

  /**
   * The Opportunity Card is the one route that asks everything it turns on.
   *
   * It states one thing beside its rules — that the card allows work of up to
   * twenty hours a week — and that statement says in its own words that it is a
   * limit on what the card lets you do, not a condition of getting it. Naming it
   * as a condition the interview fails to ask about would be the overclaim in
   * the other direction (human ruling, 2026-09-07). It keeps its caveat block
   * and names no unasked limb.
   */
  it("a route that asks everything it turns on says so, and names no limb", () => {
    const ck = routes().find((r) => r.id === "de-chancenkarte")!;
    expect(ck.scope.value).toBe("every-deciding-rule-asked");
    expect(ck.scope.not_asked).toEqual([]);
    // The caveat is still on the route, and still rendered: not naming it as
    // unasked is not the same as dropping it.
    expect(limbIdsOf(ck).has("work-limited-to-twenty-hours")).toBe(true);
    expect(statedNotAsked(ck).length).toBe(1);
    // And the file records nothing excluded of it, so the twin agrees.
    expect(excludedLimbs(exclusions).has("de-chancenkarte")).toBe(false);
  });

  it("a route the interview asks nothing of says exactly that", () => {
    // No route in the shipped dataset is in this state. The rule is held over
    // one that is, so the day the third value is needed it is already decided
    // rather than argued about.
    const asksNothing: Route = {
      id: "de-quoted-only", name: "Quoted only", kind: "res-work",
      info_url: "https://example.org/",
      criteria: [{ field: "citizenship", op: "eq", value: "third_country" }],
      scope: {
        value: "rules-quoted-nothing-asked",
        reason: "The rules of this route are quoted here in full; the checker asks nothing about it.",
        not_asked: [],
      },
    };
    expect(asksNothing.scope.not_asked).toEqual([]);
    expect(statedNotAsked(asksNothing)).toEqual([]);
    expect(limbIdsOf(asksNothing).size).toBe(0);
  });

  it("names which, where it says some are not asked", () => {
    // Step 4 of the scenario walks these by name. It named a third,
    // `de-chancenkarte`, until the step was corrected: the one thing that route
    // states is a limit on the card, not a condition of getting it.
    for (const id of ["nl-orientation-year", "es-highly-qualified"]) {
      const r = routes().find((x) => x.id === id)!;
      expect(r.scope.value, id).toBe("some-conditions-stated-not-asked");
      expect(r.scope.not_asked.length, id).toBeGreaterThan(0);
      expect(statedNotAsked(r).length, id).toBeGreaterThan(0);
    }
  });

  it("the reason is declared ours, and counted as ours", () => {
    const reasons = renderableTexts(ds).filter((t) => t.path.endsWith("/scope/reason"));
    expect(reasons.length).toBe(23);
    for (const t of reasons) expect(t.kind, t.path).toBe("ours");
    expect(proseProvenance(ds).ours).toBe(8 + 23);
  });
});

/**
 * s6 decision 2 — every quote on a route page carries its language. The fact is
 * read off the source, and no source may go unmapped: a page that guesses is a
 * page that will confidently tag a Commission sentence as German.
 */
describe("s6 — every quote can name the language it is in", () => {
  it("every source the dataset ships is covered by a declared prefix", () => {
    expect(unmappedSources(ds)).toEqual([]);
    expect(sourceUrls(ds).length).toBeGreaterThan(20);
  });

  it("the longest declared prefix wins, and each language has a name", () => {
    expect(quoteLanguage("https://www.bamf.de/EN/Themen/x.html")).toBe("en");
    expect(quoteLanguage("https://www.buzer.de/18g_AufenthG.htm")).toBe("de");
    expect(quoteLanguage("https://ind.nl/en/required-amounts-income-requirements")).toBe("en");
    expect(quoteLanguage("https://example.invalid/x")).toBeUndefined();
    for (const [, lang] of QUOTE_LANGUAGES) expect(LANGUAGE_NAMES[lang], lang).toBeTruthy();
  });
});
