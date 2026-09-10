import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import { SUMMARY_FIRST_SENTENCE_MAX, validateDataset } from "../src/validate.js";
import { proseProvenance, renderableTexts } from "../src/prose.js";
import { scopeLine, scopeWords, statedNotAsked, SCOPE_VALUES } from "../src/scope.js";
import { declaredPlace, optionMeans, unlockTitleOf } from "../src/verdict.js";
import { countryPhrase } from "../src/countries.js";
import { unlocks } from "../src/engine.js";
import {
  excludedLimbs, limbIdsOf, routesInProse, scopeDisagreesWithExclusions, twinDisagreesWithProse,
} from "../src/exclusions.js";
import {
  LANGUAGE_NAMES, QUOTE_LANGUAGES, quoteLanguage, sourceUrls, unmappedSources,
} from "../src/lang.js";
import type { Dataset, Profile, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const routes = (): Route[] => ds.countries.flatMap((c) => c.routes);
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;
/**
 * The file, read here rather than by the parser. The parser is reachable from
 * the package's entry point, which the site imports into a browser, so it may
 * not touch the filesystem — reading is the caller's job, and a test is a
 * caller (2026-09-07). CRLF is not content.
 */
const exclusions = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8")
  .split("\r\n").join("\n");

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
    // 28 since s9: 23 the product scores, five it quotes and does not.
    expect(routes().length).toBe(28);
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
      ...SCOPE_VALUES.map((v) => scopeWords(v, 2)),
      ...routes().map((r) => r.scope.reason),
    ].join(" ").toLowerCase();
    // "Scored" left this list on 2026-09-08, by the human's own choice of
    // words: "scored against your answers" says what the reader gets, which is
    // the sentence this rule exists to demand. The ban was on our pipeline
    // describing itself — "fully modelled", "criteria met on 4 of 6 criteria" —
    // and it holds for every other word on it. It is narrowed here rather than
    // deleted, with the reason, because a rule that quietly loses a term is a
    // rule nobody can audit.
    for (const word of ["modelled", "modeled", "modelling", "criterion", "criteria", "pipeline", "coverage"])
      expect(said, word).not.toContain(word);
    // And where it IS used it is used in a sentence about the reader: never
    // bare, never as a verdict, always beside what it was scored against. The
    // rule holds for the 23 authored reasons exactly as it holds for the words
    // the code composes (Standards review, 2026-09-08).
    const ALLOWED = /(?:not scored|scored,|scored against your answers)/;
    const bare = (text: string): string[] =>
      // Each use with enough either side to read it: "not scored" needs the
      // word before, the others the words after.
      [...text.matchAll(/.{0,4}scored.{0,26}/gi)]
        .map((m) => m[0])
        .filter((phrase) => !ALLOWED.test(phrase));
    for (const value of SCOPE_VALUES) {
      const words = scopeWords(value, 2, 1);
      expect(bare(words), `${value}: "${words}"`).toEqual([]);
    }
    for (const route of routes())
      expect(bare(route.scope.reason), `${route.id}: "${route.scope.reason}"`).toEqual([]);
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
    const drifted = exclusions.replace(
      "nl-ict: mvv-needed", "nl-ict: mvv-needed\nde-invented-route: (none)");
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
    // Held over an invented route since s6, when nothing in the dataset was in
    // this state. Five are now (see tests/s9.test.ts), and the rule the invented
    // one carries has changed with them: a route that asks nothing carries no
    // criteria at all, because a criterion is the one thing here that decides a
    // case, and the build refuses the combination in both directions.
    const asksNothing: Route = {
      id: "de-quoted-only", name: "Quoted only", kind: "res-work",
      info_url: "https://example.org/",
      criteria: [],
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
    expect(reasons.length).toBe(28);
    for (const t of reasons) expect(t.kind, t.path).toBe("ours");
    // 13 route readings + these 28 reasons + the 2 contradiction sentences and
    // the 3 money-question doors added on 2026-09-08. Five of each arrived with
    // s9, on the routes that are quoted and not scored.
    expect(proseProvenance(ds).ours).toBe((8 + 5) + (23 + 5) + 2 + 3);
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

/**
 * The human's walk, 2026-09-08: a reader whose employer was moving them to its
 * Dutch branch read "With a job offer → Highly skilled migrant would be met" as
 * something they already had. They do have an offer. They do not have this one.
 */
describe("an answer a reader can mistake for the one they hold says what it means", () => {
  const optionsOf = (field: string) =>
    ds.fields.find((f) => f.id === field)!.options!;

  it("the two situations a transferee confuses each say what they mean", () => {
    const situation = optionsOf("situation");
    for (const value of ["offer", "ict"]) {
      const option = situation.find((o) => o.value === value)!;
      expect(option.means, value).toBeTruthy();
      expect(option.means, value).toContain("{place}");
      expect(option.means, value).toMatch(/\.$/);
    }
    // Each names what the other is, so the pair can be told apart.
    expect(situation.find((o) => o.value === "offer")!.means).toMatch(/not a transfer/i);
    expect(situation.find((o) => o.value === "ict")!.means).toMatch(/contract stays with the company abroad/i);
  });

  it("no country is named in the words — the place comes from the reader", () => {
    for (const option of optionsOf("situation"))
      for (const country of ds.countries)
        expect(option.means ?? "", `${option.value} names ${country.name}`).not.toContain(country.name);
  });

  it("the place is filled in from what was declared, with its article", () => {
    const offer = optionsOf("situation").find((o) => o.value === "offer")!;
    expect(optionMeans(offer, ds, { destination: "nl" }))
      .toBe("An employment contract with an employer in the Netherlands itself — including one you already hold — not a transfer to a branch on a contract you hold abroad.");
    expect(optionMeans(offer, ds, { destination: "de" })).toContain("an employer in Germany itself");
    // Nothing declared yet: the sentence still reads, in the word the option
    // labels already use.
    expect(optionMeans(offer, ds, {})).toContain("an employer there itself");
    // No token survives rendering, ever.
    const profiles: Profile[] = [{}, { destination: "nl" }, { destination: "all" }, { situation_country: "NL" }];
    for (const profile of profiles)
      for (const option of optionsOf("situation"))
        expect(optionMeans(option, ds, profile)).not.toContain("{place}");
    // An option with nothing to distinguish says nothing.
    expect(optionMeans(optionsOf("situation").find((o) => o.value === "none")!, ds, { destination: "nl" })).toBe("");
  });

  it("a country's article travels with its name, not with a renderer", () => {
    expect(countryPhrase("NL")).toBe("the Netherlands");
    expect(countryPhrase("DE")).toBe("Germany");
    expect(countryPhrase("ZZ")).toBeUndefined();
    expect(declaredPlace(ds, { destination: "nl" })).toBe("the Netherlands");
    expect(declaredPlace(ds, { destination: "de" })).toBe("Germany");
    expect(declaredPlace(ds, { destination: "all" })).toBe("");
  });

  it("the leverage row keeps the short step, and the meaning rides beside it", () => {
    const profile = {
      destination: "nl", citizenship: "TR", situation: "ict",
      salary_eur_month: "band_6", nl_recent_grad: "no", top200_grad: "no", age_band: "a30to35",
    };
    const rows = unlocks(ds, profile);
    const offer = rows.find((u) => u.field === "situation" && u.option.value === "offer");
    expect(offer, "the job-offer step is the one the walk turned on").toBeDefined();
    // The row is still scanned by its short step.
    expect(unlockTitleOf(ds, offer!)).toBe("a job offer");
    // And the sentence beside it says which offer.
    expect(optionMeans(offer!.option, ds, profile)).toContain("in the Netherlands itself");
    expect(offer!.routes.some((r) => r.route.id === "nl-hsm-30plus" && r.status === "met")).toBe(true);
  });
});

/**
 * What the source states without our asking and what WE read into the gap are
 * different claims, and two routes were saying an authority "stated" our own
 * note (Spec review, 2026-09-08): de-skilled-vocational's two conditions are
 * both readings, and fr-talent-qualifie has one of each.
 */
describe("a reading is ours, and the words say so", () => {
  const of = (id: string) => routes().find((r) => r.id === id)!;

  it("splits what is stated from what is noted, and counts each", () => {
    const vocational = statedNotAsked(of("de-skilled-vocational"), { split: true });
    expect(vocational.stated, "a source statement appeared from nowhere").toEqual([]);
    expect(vocational.noted.length).toBe(2);
    expect(scopeLine(of("de-skilled-vocational")))
      .toBe("quoted and dated · scored, two in our own reading, not asked");

    const talent = statedNotAsked(of("fr-talent-qualifie"), { split: true });
    expect(talent.stated.length).toBe(1);
    expect(talent.noted.length).toBe(1);
    expect(scopeLine(of("fr-talent-qualifie")))
      .toBe("quoted and dated · scored, one condition stated but not asked and one in our own reading");
  });

  it("the split is the same list the evidence is read from", () => {
    for (const route of routes()) {
      const split = statedNotAsked(route, { split: true });
      expect([...split.stated, ...split.noted], route.id).toEqual(statedNotAsked(route));
      // And the sentence counts exactly what the split holds.
      const line = scopeLine(route);
      if (route.scope.value !== "some-conditions-stated-not-asked") continue;
      expect(split.stated.length + split.noted.length, route.id).toBeGreaterThan(0);
      expect(line.includes("stated but not asked"), route.id).toBe(split.stated.length > 0);
      expect(line.includes("in our own reading"), route.id).toBe(split.noted.length > 0);
    }
  });

  it("the count is required, and nothing prints a number nobody passed", () => {
    // The type says so; this says what happens if a caller ignores the type,
    // because `expect(fn).toBeDefined()` cannot fail (Standards review,
    // 2026-09-08).
    // @ts-expect-error the second argument is not optional any more.
    const said = scopeWords("some-conditions-stated-not-asked");
    expect(said).not.toContain("undefined");
    expect(said).not.toContain("NaN");
    expect(scopeWords("some-conditions-stated-not-asked", 1, 0))
      .toBe("quoted and dated · scored, one condition stated but not asked");
    // And the reading form never borrows the avoid-list words.
    for (const words of [scopeWords("some-conditions-stated-not-asked", 0, 2),
      scopeWords("some-conditions-stated-not-asked", 1, 1)]) {
      expect(words).not.toContain("we note");
      expect(words).toContain("in our own reading");
    }
  });
});

/**
 * A country-index card prints the summary's first sentence whole. It used to
 * be cut at 110 characters with an ellipsis on ten of the twenty-three cards
 * (Spec review, 2026-09-08); now the sentence is bounded instead, so what a
 * card shows is always a sentence somebody wrote to stand alone.
 */
describe("the sentence a card has to hold is bounded", () => {
  const firstSentence = (route: { summary?: string }) =>
    (route.summary ?? "").split(/(?<=[.])\s/)[0] ?? "";

  it("every route's first sentence fits a card, and ends like a sentence", () => {
    for (const route of routes()) {
      const first = firstSentence(route);
      expect(first.length, `${route.id}: ${first.length} characters`)
        .toBeLessThanOrEqual(SUMMARY_FIRST_SENTENCE_MAX);
      if (first) expect(first.trimEnd().endsWith("."), `${route.id}: "${first.slice(-40)}"`).toBe(true);
    }
  });

  it("and a longer one fails the build rather than being cut", () => {
    const wrecked = JSON.parse(JSON.stringify(dataset)) as Dataset;
    const route = wrecked.countries[0]!.routes[0]!;
    route.summary = `${"A sentence that runs and runs and keeps running ".repeat(6)}.`;
    const said = validateDataset(wrecked).errors.map((e) => e.keyword);
    expect(said, "an oversized first sentence passed the build").toContain("summaryFirstSentence");
  });
});

