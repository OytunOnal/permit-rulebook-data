import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, informativeFields, isRouteAlive, notices } from "../src/engine.js";
import { deriveQuestions, remainingQuestions } from "../src/questions.js";
import { validateDataset } from "../src/validate.js";
import { vocabularyErrors, type CountryVocabulary } from "../src/countries.js";
import { checkCoverage, checkQuotes, datasetQuotes, datasetSourceUrls, type WatchState, type Watchlist } from "../src/watch/core.js";
import type { Dataset, Profile, Question } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const shippedWatchlist = JSON.parse(readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;
const shippedState = JSON.parse(readFileSync(new URL("../watch/state.json", import.meta.url), "utf8")) as WatchState;
const vocabulary = JSON.parse(readFileSync(new URL("../data/countries.json", import.meta.url), "utf8")) as CountryVocabulary;

const load = () => JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));

const statusMap = (p: Profile) =>
  Object.fromEntries(evaluate(dataset, p).map((r) => [r.route.id, `${r.status}|${r.gap_max ?? ""}|${r.gap_points ?? ""}`]));

/** Members of a class, read from the vocabulary rather than restated here. */
const membersOf = (cls: string) => vocabulary.classes[cls].members ?? [];
const thirdCountries = () =>
  vocabulary.countries.map((c) => c.code).filter((c) => !membersOf("eu_eea_ch").includes(c));

const baseOffer: Profile = {
  destination: "de", situation: "offer", qualification: "degree",
  occupation_shortage: "no", occupation_it: "no", experience: "y2in5", age_band: "a30to35",
};

describe("s5c — a passport is a country, and the rules read it through classes", () => {
  it("the citizenship question offers the country list, ordered by name", () => {
    const q = deriveQuestions(dataset).find((x) => x.field === "citizenship")!;
    expect(q.options.length).toBe(vocabulary.countries.length);
    expect(q.options.length).toBeGreaterThan(12);
    const names = q.options.map((o) => o.label);
    expect([...names].sort((a, b) => a.localeCompare(b, "en"))).toEqual(names);
    expect(q.options.find((o) => o.value === "TR")!.label).toBe("Türkiye");
  });

  it("the dataset declares citizenship by reference — the list is not inlined", () => {
    const def = dataset.fields.find((f) => f.id === "citizenship")!;
    expect(def.options_from).toBe("countries");
    expect(def.options).toBeUndefined();
  });

  it("a country answer satisfies the class criterion its `implies` names", () => {
    // Not one route criterion changed: they still read `eq third_country`.
    expect(statusMap({ ...baseOffer, citizenship: "TR" })).toEqual(statusMap({ ...baseOffer, citizenship: "third_country" }));
    expect(statusMap({ ...baseOffer, citizenship: "IE" })).toEqual(statusMap({ ...baseOffer, citizenship: "eu_eea_ch" }));
  });

  it("an option without `implies` satisfies its own value and nothing else", () => {
    // Every field but the passport still answers only for itself.
    for (const def of dataset.fields)
      if (def.id !== "citizenship")
        expect(fieldOptions(dataset, def.id).every((o) => o.implies === undefined), def.id).toBe(true);
    // `situation eq offer` must not start passing for an intra-corporate transfer.
    const offer = statusMap({ ...baseOffer, citizenship: "TR" });
    const ict = statusMap({ ...baseOffer, citizenship: "TR", situation: "ict" });
    expect(offer).not.toEqual(ict);
  });
});

describe("s5c — class invariance: the property that makes the list safe to grow", () => {
  // Deterministic PRNG so every run checks the same profile population.
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  }

  it("swapping the passport for another country of the same class changes no verdict, gap or points", () => {
    const rand = lcg(5150);
    const third = thirdCountries();
    const free = membersOf("eu_eea_ch");
    for (let i = 0; i < 120; i++) {
      const profile: Profile = {};
      for (const def of dataset.fields) {
        if (def.id === "citizenship") continue;
        if (rand() < 0.7) {
          const vals = def.type === "money_band"
            ? deriveBands(dataset, def.id).map((b) => b.id)
            : fieldOptions(dataset, def.id).map((o) => o.value);
          profile[def.id] = vals[Math.floor(rand() * vals.length)];
        }
      }
      for (const pool of [third, free]) {
        const reference = statusMap({ ...profile, citizenship: pool[0] });
        for (let k = 0; k < 6; k++) {
          const code = pool[Math.floor(rand() * pool.length)];
          expect(statusMap({ ...profile, citizenship: code }), `profile ${i}, passport ${code}`).toEqual(reference);
        }
      }
    }
  });

  it("every country carries exactly one class, and both directions are closed", () => {
    const codes = vocabulary.countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const member of membersOf("eu_eea_ch")) expect(codes).toContain(member);
    // Exactly one class enumerates members; the other is the complement.
    const enumerated = Object.values(vocabulary.classes).filter((c) => c.members !== undefined);
    expect(enumerated.length).toBe(1);
    // Every class a criterion or notice reads exists in the vocabulary.
    const q = deriveQuestions(dataset).find((x) => x.field === "citizenship")!;
    for (const o of q.options) {
      expect(o.implies).toHaveLength(1);
      expect(Object.keys(vocabulary.classes)).toContain(o.implies![0]);
    }
  });
});

describe("s5c — notices match through the same predicate the criteria use", () => {
  const german = { destination: "de", situation: "offer" };

  it("a Turkish passport fires the extra-rights notice, quoted and dated", () => {
    const matched = notices(dataset, { ...german, citizenship: "TR" });
    expect(matched.map((n) => n.id)).toEqual(["tr-ankara-rights"]);
    expect(matched[0].kind).toBe("extra-rights");
    expect(matched[0].source.quote).toContain("As a national of Türkiye");
    expect(matched[0].source.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a Brazilian passport fires nothing — the routes are the answer", () => {
    expect(notices(dataset, { ...german, citizenship: "BR" })).toEqual([]);
  });

  it("an Irish passport fires free movement, exactly as the old EU option did", () => {
    const matched = notices(dataset, { ...german, citizenship: "IE" });
    expect(matched.map((n) => n.id)).toEqual(["eu-free-movement"]);
    expect(matched[0].kind).toBe("no-permit-needed");
  });

  it("an extra-rights notice never replaces the results: the routes still evaluate", () => {
    // The zero-open screen belongs to "you need no permit"; an extra-rights
    // notice sits beside whatever the rules computed, including nothing.
    const explorer: Profile = { destination: "all", citizenship: "TR", situation: "none", qualification: "none" };
    const matched = notices(dataset, explorer);
    expect(matched.every((n) => n.kind !== "no-permit-needed")).toBe(true);
    const results = evaluate(dataset, explorer);
    expect(results.length).toBe(dataset.countries.flatMap((c) => c.routes).length);
    expect(results.filter((r) => r.status === "met" || r.status === "near")).toEqual([]);
  });
});

describe("s5c — the country list costs the interview nothing", () => {
  function runFlow(answers: Profile): string[] {
    const profile: Profile = {};
    const asked: string[] = [];
    for (let i = 0; i < 50; i++) {
      const remaining = remainingQuestions(dataset, profile);
      if (remaining.length === 0) break;
      const q = remaining[0];
      if (answers[q.field] === undefined) throw new Error(`persona has no answer for ${q.field}`);
      asked.push(q.field);
      profile[q.field] = answers[q.field];
    }
    return asked;
  }

  it("a German offer-holder with a German passport still answers at most 8 questions", () => {
    const asked = runFlow({
      destination: "de", citizenship: "DE", situation: "offer", qualification: "degree",
      occupation_shortage: "no", occupation_it: "no", experience: "y2in5", age_band: "a30to35",
      recognition_de: "recognized", german: "b1", english: "b2", de_stay6m: "no", partner_ck: "no",
      salary_eur_year: "band_0", salary_eur_month: "band_0", funds_eur_month: "band_0",
      experience_7y: "no", nl_recent_grad: "no", top200_grad: "no", fr_degree: "no",
      qualification_recent: "no", fr_innovative_employer: "no", fr_local_contract: "no",
      situation_country: "de",
    });
    expect(asked.length).toBeLessThanOrEqual(8);
    expect(asked).toContain("citizenship");
  });

  it("the French-only fields are never asked outside a French flow", () => {
    for (const dest of ["de", "es", "nl"]) {
      const informative = informativeFields(dataset, { destination: dest, citizenship: "TR", situation: "offer" });
      expect([...informative], dest).not.toContain("fr_innovative_employer");
      expect([...informative], dest).not.toContain("fr_local_contract");
    }
  });

  it("no German route reads the recent-qualification fact, so a German flow never asks it", () => {
    const informative = informativeFields(dataset, { destination: "de", citizenship: "TR", situation: "offer" });
    expect([...informative]).not.toContain("qualification_recent");
  });
});

describe("s5c — question ordering scores equivalence classes, not two hundred options", () => {
  /** The naive computation A4 must reproduce exactly: average live-route count
   * over EVERY option, ties keeping dataset order. */
  function naiveOrder(profile: Profile): string[] {
    const informative = informativeFields(dataset, profile);
    const candidates = deriveQuestions(dataset).filter(
      (q) => profile[q.field] === undefined && informative.has(q.field),
    );
    const pinned = candidates.filter((q) => dataset.fields.find((f) => f.id === q.field)?.ask_first);
    const rest = candidates.filter((q) => !pinned.includes(q));
    const live = (p: Profile) => {
      let n = 0;
      for (const c of dataset.countries) for (const r of c.routes) if (isRouteAlive(dataset, r, p)) n++;
      return n;
    };
    const score = (q: Question) =>
      q.options.reduce((t, o) => t + live({ ...profile, [q.field]: o.value }), 0) / q.options.length;
    return [...pinned, ...rest
      .map((q, i) => ({ q, i, s: score(q) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((x) => x.q)].map((q) => q.field);
  }

  const partials: Profile[] = [
    {},
    { destination: "de" },
    { destination: "all", situation: "offer" },
    { destination: "nl", citizenship: "TR", situation: "offer", qualification: "degree" },
    { destination: "fr", citizenship: "BR", situation: "ict" },
    { destination: "es", citizenship: "TR", situation: "offer", qualification: "degree", experience: "y2in5" },
  ];

  for (const [i, p] of partials.entries()) {
    it(`profile ${i + 1}: the shipped ordering equals the naive one`, () => {
      expect(remainingQuestions(dataset, p).map((q) => q.field)).toEqual(naiveOrder(p));
    });
  }
});

describe("s5c — validation: a class is a rule, so the boundary enforces it", () => {
  it("the shipped dataset is valid against the country vocabulary", () => {
    expect(validateDataset(load()).errors).toEqual([]);
  });

  it("a criterion referencing an unknown class fails", () => {
    const data = load();
    const nl = data.countries.find((c: { code: string }) => c.code === "NL");
    nl.routes[0].criteria[0].value = "schengen_only";
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { keyword: string }) => e.keyword === "knownCountryValue")).toBe(true);
  });

  it("a notice whose `when` value is neither a country nor a class fails", () => {
    const data = load();
    data.notices[0].when.value = "ankara_agreement";
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e: { keyword: string }) => e.keyword === "knownCountryValue")).toBe(true);
  });

  it("a country with no class fails", () => {
    const vocab = structuredClone(vocabulary);
    delete vocab.classes.third_country; // the complement is gone: 200-odd orphans
    expect(vocabularyErrors(vocab).some((e) => e.keyword === "countryClass")).toBe(true);
  });

  it("a country claimed by two classes fails", () => {
    const vocab = structuredClone(vocabulary);
    vocab.classes.third_country.members = ["TR"];
    vocab.classes.eu_eea_ch.members = [...membersOf("eu_eea_ch"), "TR"];
    expect(vocabularyErrors(vocab).some((e) => e.keyword === "countryClass")).toBe(true);
  });

  it("a class member that is not in the country list fails", () => {
    const vocab = structuredClone(vocabulary);
    vocab.classes.eu_eea_ch.members = [...membersOf("eu_eea_ch"), "XX"];
    expect(vocabularyErrors(vocab).some((e) => e.keyword === "countryClass")).toBe(true);
  });
});

describe("s5c — the class sources are watched and their quotes verify", () => {
  it("every class source counts as a dataset source", () => {
    const urls = datasetSourceUrls(dataset);
    for (const src of vocabulary.classes.eu_eea_ch.sources as { source_url: string }[])
      expect([...urls]).toContain(src.source_url);
  });

  it("the shipped watchlist covers them, both ways", () => {
    const result = checkCoverage(dataset, shippedWatchlist);
    expect(result.missing_from_watchlist).toEqual([]);
    expect(result.orphan_watch_entries).toEqual([]);
  });

  it("every class quote is still on the page it cites", () => {
    const classQuotes = datasetQuotes(dataset).filter((q) => q.where.startsWith("class:"));
    expect(classQuotes.length).toBe((vocabulary.classes.eu_eea_ch.sources as unknown[]).length);
    const check = checkQuotes(dataset, shippedWatchlist, shippedState);
    expect(check.missing).toEqual([]);
    // The Türkiye notice and the class legs are all machine-watched html.
    expect(check.unverifiable.map((u) => u.where)).not.toContain("notice:tr-ankara-rights");
    for (const q of classQuotes) expect(check.unverifiable.map((u) => u.where)).not.toContain(q.where);
  });
});
