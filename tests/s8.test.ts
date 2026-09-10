import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  closedBy, datasetMeta, deriveBands, evaluate, isRouteAlive, noticeSources, notices,
  routeProvenance,
} from "../src/engine.js";
import { excludedLimbs, routesInProse, twinDisagreesWithProse } from "../src/exclusions.js";
import { unmappedSources } from "../src/lang.js";
import { quotedWithoutProvenance } from "../src/prose.js";
import { reasonFor } from "../src/verdict.js";
import { validateDataset } from "../src/validate.js";
import {
  checkCoverage, checkQuotes, datasetQuotes, datasetSourceUrls, sliceFingerprint,
  type WatchState, type Watchlist,
} from "../src/watch/core.js";
import type { Criterion, Dataset, Profile, Route } from "../src/types.js";

const readJson = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8").replace(/^﻿/, ""));

const dataset = readJson("../data/dataset.json") as Dataset;
const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const state = readJson("../watch/state.json") as WatchState;
const exclusionsMd = readFileSync(new URL("../data/exclusions.md", import.meta.url), "utf8");

const routes = (): Route[] => dataset.countries.flatMap((c) => c.routes);
const routeOf = (id: string): Route => routes().find((r) => r.id === id)!;
const clone = (): Dataset => structuredClone(dataset);

/** The four passeport-talent routes the sources do not settle. */
const TALENT = ["fr-talent-qualifie", "fr-talent-blue-card", "fr-talent-innovante", "fr-talent-mission"];

const ICT_SOURCE = "https://www.service-public.gouv.fr/particuliers/vosdroits/F33952";
const COUNCIL_SOURCE = "https://www.legifrance.gouv.fr/ceta/id/CETATEXT000053612496";
const DIRECTIVE_SOURCE = "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021L1883";
const ALGERIAN_PAGE = "https://www.service-public.gouv.fr/particuliers/vosdroits/F2215";

const topYearBand = (): string => deriveBands(dataset, "salary_eur_year").at(-1)!.id;

/** A qualified job offer in France, answered in full. */
const withPassport = (citizenship: string): Profile => ({
  destination: "fr", citizenship, situation: "offer", situation_country: "fr",
  qualification: "degree", fr_degree: "yes", fr_innovative_employer: "no", fr_local_contract: "no",
  experience: "y5in7", salary_eur_year: topYearBand(),
});

/** The same reader, moved to France by their group — the profile fr-ict is for. */
const transferring = (citizenship: string): Profile => ({
  ...withPassport(citizenship), situation: "ict", salary_eur_month: deriveBands(dataset, "salary_eur_month").at(-1)!.id,
});

const statusOf = (profile: Profile, id: string): string =>
  evaluate(dataset, profile).find((r) => r.route.id === id)!.status;

const closingCriterion = (): Extract<Criterion, { op: "not-in" }> =>
  routeOf("fr-ict").criteria.find((c): c is Extract<Criterion, { op: "not-in" }> => c.op === "not-in")!;

/**
 * s8 — "A route the authority closes to a passport, and a question the sources
 * do not settle".
 *
 * France reads differently from the Netherlands and Germany. There the product
 * stated one condition too many; here it showed a nationality a route that does
 * not exist for them — the heavier failure, because a reader acts on a route,
 * not on a condition. And on the four talent cards the sources conflict, which
 * is a third thing again: not a route to withdraw and not a route to promise.
 */
describe("s8 — the transfer card France closes to an Algerian passport", () => {
  it("quotes the eligibility sentence that closes it, with the day it was read", () => {
    const closing = closingCriterion();
    expect(closing.values).toEqual(["DZ"]);
    expect(closing.source.source_url).toBe(ICT_SOURCE);
    expect(closing.source.quote).toContain("Vous êtes étranger (sauf Européen ou Algérien)");
    expect(closing.source.retrieved_at).toBe("2026-09-10");
  });

  it("does not offer it to an Algerian passport, and does to a Turkish one", () => {
    const algerian = transferring("DZ");
    const turkish = transferring("TR");
    expect(isRouteAlive(dataset, routeOf("fr-ict"), algerian)).toBe(false);
    expect(statusOf(turkish, "fr-ict")).toBe("met");
    // Closed is its own answer: it is not "not yet", and the criterion that
    // says so is the one a screen must read to keep the route off the list.
    const closed = evaluate(dataset, algerian).find((r) => r.route.id === "fr-ict")!;
    expect(closedBy(closed).map((cr) => cr.criterion.op)).toEqual(["not-in"]);
    expect(closedBy(evaluate(dataset, turkish).find((r) => r.route.id === "fr-ict")!)).toEqual([]);
  });

  it("says why in the authority's own words, and never as a shortfall", () => {
    const algerian = transferring("DZ");
    const result = evaluate(dataset, algerian).find((r) => r.route.id === "fr-ict")!;
    const reason = reasonFor(dataset, result, algerian);
    expect(reason.line).toBe(closingCriterion().text);
    expect(reason.rows.some((row) => row.kind === "closed" && row.text === closingCriterion().text)).toBe(true);
    // A closure is not a gap to close, so it never joins the "Needs …" list —
    // "Needs Algeria" is what composing this criterion would have produced.
    expect(reason.parts.needs.join(" ")).not.toContain("Algeria");
  });

  it("leaves a French passport to the free-movement notice, as before", () => {
    // An EU passport fails the route's own `citizenship eq third_country` and
    // is answered by the notice that replaces the results — the closure never
    // reaches it, and nothing about this reader changed.
    const french = transferring("eu_eea_ch");
    expect(closedBy(evaluate(dataset, french).find((r) => r.route.id === "fr-ict")!)).toEqual([]);
    expect(notices(dataset, french).map((n) => n.id)).toEqual(["eu-free-movement"]);
  });

  it("puts the closure's quote among the route's own provenance", () => {
    expect(routeProvenance(routeOf("fr-ict")).map((e) => e.value.quote))
      .toContain(closingCriterion().source.quote);
  });
});

describe("s8 — a criterion may exclude answers, and only on the authority's word", () => {
  const withClosure = (patch: Record<string, unknown>): Dataset => {
    const ds = clone();
    const route = ds.countries.flatMap((c) => c.routes).find((r) => r.id === "fr-talent-qualifie")!;
    route.criteria.push(patch as unknown as Criterion);
    return ds;
  };

  const good = {
    field: "citizenship", op: "not-in", values: ["DZ"],
    text: "This permit is not open to an Algerian passport.",
    source: { source_url: ICT_SOURCE, quote: "sauf Européen ou Algérien", retrieved_at: "2026-09-10" },
  };

  it("accepts one that names its answers, its words and its quote", () => {
    expect(validateDataset(withClosure(good)).ok).toBe(true);
  });

  it("refuses an empty list — a closure that shuts nobody out is not one", () => {
    expect(validateDataset(withClosure({ ...good, values: [] })).ok).toBe(false);
  });

  it("refuses an answer the field cannot take", () => {
    const result = validateDataset(withClosure({ ...good, values: ["DZ", "schengen_only"] }));
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toContain("schengen_only");
  });

  it("refuses one with no source, and one with nothing to say", () => {
    const { source: _dropped, ...noSource } = good;
    expect(validateDataset(withClosure(noSource)).ok).toBe(false);
    expect(validateDataset(withClosure({ ...good, text: "" })).ok).toBe(false);
  });

  it("passes an answer that is not on the list, and fails one that is", () => {
    const ds = withClosure(good);
    const outcome = (citizenship: string) =>
      evaluate(ds, withPassport(citizenship)).find((r) => r.route.id === "fr-talent-qualifie")!
        .criteria.find((cr) => cr.criterion.op === "not-in")!.outcome;
    expect(outcome("DZ")).toBe("fail");
    expect(outcome("TR")).toBe("pass");
  });

  it("says nothing about a reader who has not answered yet", () => {
    const ds = withClosure(good);
    const result = evaluate(ds, { destination: "fr" }).find((r) => r.route.id === "fr-talent-qualifie")!;
    expect(result.criteria.find((cr) => cr.criterion.op === "not-in")!.outcome).toBe("unknown");
  });
});

describe("s8 — the question the sources do not settle", () => {
  const notice = () => dataset.notices!.find((n) => n.id === "fr-dz-talent-open-question")!;

  it("stands for an Algerian passport and for nobody else", () => {
    expect(notices(dataset, withPassport("DZ")).map((n) => n.id)).toContain("fr-dz-talent-open-question");
    for (const passport of ["TR", "JP", "third_country"])
      expect(notices(dataset, withPassport(passport)).map((n) => n.id), passport)
        .not.toContain("fr-dz-talent-open-question");
    // A French passport is answered by the notice that replaces the results.
    expect(notices(dataset, withPassport("eu_eea_ch")).map((n) => n.id)).toEqual(["eu-free-movement"]);
    // And a silence is not a passport.
    expect(notices(dataset, { destination: "fr" })).toEqual([]);
  });

  it("is declared an open question, not a right the reader gains", () => {
    expect(notice().kind).toBe("open-question");
  });

  it("carries both sides, each in its own authority's words", () => {
    const sources = noticeSources(notice());
    expect(sources.map((s) => s.source_url)).toEqual([COUNCIL_SOURCE, ALGERIAN_PAGE, DIRECTIVE_SOURCE]);
    expect(sources[0].quote).toContain("ne sont pas applicables aux ressortissants algériens");
    // What the reader's own page offers them instead, in its words.
    expect(sources[1].quote).toBe("Le certificat de résidence portera la mention salarié.");
    expect(sources[2].quote).toContain("This Directive applies to third-country nationals");
    for (const s of sources) expect(s.retrieved_at).toBe("2026-09-10");
  });

  it("does not read the court's case for more than it decided", () => {
    // The Conseil d'État ruled on a certificat de résidence "commerçant", not
    // on a talent card. The notice may cite the principle; it may not put the
    // four permits inside a judgment that never mentioned them.
    expect(notice().body).toMatch(/commer|trader/i);
  });

  it("sends the reader to the page the administration itself routes them to", () => {
    expect(notice().learn?.url).toBe(ALGERIAN_PAGE);
    expect(notice().learn?.label.length).toBeGreaterThan(4);
  });

  it("names the four permits it is about, and no others", () => {
    expect([...notice().routes!].sort()).toEqual([...TALENT].sort());
  });

  it("leaves the four routes scored exactly as they are for any other passport", () => {
    // The product does not decide an open question by hiding the routes.
    for (const id of TALENT) {
      expect(statusOf(withPassport("DZ"), id), id).toBe(statusOf(withPassport("TR"), id));
      expect(closedBy(evaluate(dataset, withPassport("DZ")).find((r) => r.route.id === id)!), id).toEqual([]);
    }
    expect(statusOf(withPassport("DZ"), "fr-talent-qualifie")).toBe("met");
  });
});

describe("s8 — the new sources are watched and quote-checked like every other value", () => {
  it("puts every new source on the watchlist", () => {
    const urls = datasetSourceUrls(dataset);
    for (const url of [COUNCIL_SOURCE, DIRECTIVE_SOURCE, ALGERIAN_PAGE]) expect([...urls], url).toContain(url);
    for (const id of ["legifrance-ce-algerian-titles", "eur-lex-blue-card-directive", "fr-f2215-certificat-algerien"])
      expect(watchlist.entries.find((e) => e.id === id), id).toBeDefined();
  });

  it("declares the two sources no fetcher here can reach, rather than pretending to check them", () => {
    // Legifrance answers this watch with HTTP 403 and EUR-Lex with a 202 and
    // an empty body (both measured 2026-09-10). The honest tier for a page a
    // person can read and a machine cannot is the one the statute book already
    // uses — and the quote gate must SAY so rather than counting them verified.
    for (const id of ["legifrance-ce-algerian-titles", "eur-lex-blue-card-directive"]) {
      const entry = watchlist.entries.find((e) => e.id === id)!;
      expect(entry.strategy, id).toBe("human");
      expect(entry.kind, id).toBe("value-source");
      expect(entry.last_verified, id).toBe("2026-09-10");
    }
    const unverifiable = checkQuotes(dataset, watchlist, state).unverifiable.map((u) => u.source_url);
    for (const url of [COUNCIL_SOURCE, DIRECTIVE_SOURCE]) expect(unverifiable, url).toContain(url);
  });

  it("slices the page it can read to the enumeration the notice reports, re-baselined in the same change", () => {
    const entry = watchlist.entries.find((e) => e.id === "fr-f2215-certificat-algerien")!;
    expect(entry.slice).toBeDefined();
    // The watch rule written on 2026-09-09: a change that adds or moves a
    // slice re-reads that entry's baseline in the same change, or the next
    // run files our own edit as the authority's. The same rule reaches the two
    // French fiches whose READING moved when the tooltip artefact was dropped.
    for (const id of ["fr-f2215-certificat-algerien", "fr-f33952-ict", "fr-f16922-talent"]) {
      const e = watchlist.entries.find((x) => x.id === id)!;
      expect(state.entries[id], id).toBeDefined();
      expect(state.entries[id].slice_read, id).toBe(sliceFingerprint(e));
      expect(state.entries[id].retrieved_at, id).toBe("2026-09-10");
    }
  });

  it("reads a tooltip's placeholder out of the sentence it sits inside", () => {
    // service-public ships the definition popover holding the literal, unfilled
    // ": titleContent". Spliced into the eligibility list it made the sentence
    // that closes this permit unquotable — and the closure could not ship.
    const snapshot = state.entries["fr-f33952-ict"].text!;
    expect(snapshot).not.toContain("titleContent");
    expect(snapshot).toContain(closingCriterion().source.quote);
  });

  it("watches the page the notice sends the reader to, so a dead link cannot strand them", () => {
    const entry = watchlist.entries.find((e) => e.url === ALGERIAN_PAGE);
    expect(entry, "the page for Algerian readers is on no watch entry").toBeDefined();
    expect(checkCoverage(dataset, watchlist).ok).toBe(true);
  });

  it("checks every new sentence against the page it cites", () => {
    const quotes = datasetQuotes(dataset);
    for (const url of [ICT_SOURCE, COUNCIL_SOURCE, DIRECTIVE_SOURCE])
      expect(quotes.filter((q) => q.source_url === url).length, url).toBeGreaterThan(0);
    expect(checkQuotes(dataset, watchlist, state).missing).toEqual([]);
  });

  it("names the language of both new sources, so no quote is read aloud in the wrong one", () => {
    expect(unmappedSources(dataset)).toEqual([]);
  });

  it("keeps every reader-facing sentence attributable", () => {
    expect(quotedWithoutProvenance(dataset)).toEqual([]);
  });

  it("a fresher source is a fresher dataset", () => {
    expect(datasetMeta(dataset).newest_retrieved_at).toBe("2026-09-10");
    const bumped = clone();
    bumped.notices!.find((n) => n.id === "fr-dz-talent-open-question")!.sources![0].retrieved_at = "2099-01-01";
    expect(datasetMeta(bumped).newest_retrieved_at).toBe("2099-01-01");
  });
});

describe("s8 — what an Algerian national actually applies for is recorded", () => {
  it("exclusions.md names the certificat de résidence and dates the search that found nothing", () => {
    expect(exclusionsMd).toContain("27 décembre 1968");
    expect(exclusionsMd).toMatch(/certificat de résidence/);
    expect(exclusionsMd).toContain("2026-09-10");
  });

  it("and the file still agrees with itself and with the routes", () => {
    expect(twinDisagreesWithProse(exclusionsMd)).toEqual([]);
    for (const id of routesInProse(exclusionsMd)) expect(excludedLimbs(exclusionsMd).has(id), id).toBe(true);
  });
});

/**
 * The two the Spec review found, kept as the cases that would have caught them.
 *
 * A notice that names routes is about those routes: an Algerian passport
 * looking only at Germany was shown an open question about four French permits
 * that were not on the screen. And a criterion may not close a route on a field
 * whose answers nothing enumerates — a closure nobody can check is a closure
 * that fails everyone.
 */
describe("a notice about routes goes where those routes go", () => {
  const algerian = (destination: string): Profile => ({ citizenship: "DZ", destination });

  it("stands over a screen that has one of its routes", () => {
    const shown = notices(dataset, algerian("fr")).map((n) => n.id);
    expect(shown).toContain("fr-dz-talent-open-question");
  });

  it("says nothing over a screen that has none of them", () => {
    for (const destination of ["de", "es", "nl"]) {
      const shown = notices(dataset, algerian(destination)).map((n) => n.id);
      expect(shown, destination).not.toContain("fr-dz-talent-open-question");
    }
  });

  it("still reaches a reader who asked about every country", () => {
    const shown = notices(dataset, algerian("all")).map((n) => n.id);
    expect(shown).toContain("fr-dz-talent-open-question");
  });

  it("a notice that names no route is about the reader, and follows them everywhere", () => {
    // Decision 1/80 is not one country's, and the Türkiye notice names no
    // routes — it must not be narrowed by this rule.
    for (const destination of ["de", "fr", "es", "nl", "all"]) {
      const shown = notices(dataset, { citizenship: "TR", destination }).map((n) => n.id);
      expect(shown, destination).toContain("tr-ankara-rights");
    }
  });
});

describe("a closure names an answer, or it says nothing", () => {
  /**
   * The Spec review asked for the third branch build item 2 named — a closure
   * on "a field with no vocabulary". There is no such guard, and there was no
   * hole either: `checkVocabulary` is scoped to the fields whose answers come
   * from countries.json, and every other field is guarded by `checkWords`,
   * which refuses a criterion naming an answer that carries no noun phrase.
   * The spec's phrase was mine and it described a validator this repository
   * does not have; the case below is the one that holds (session, 2026-09-10).
   */
  it("refuses a closure whose answer carries no words of its own", () => {
    const broken = structuredClone(dataset) as Dataset;
    const route = broken.countries.find((c) => c.code === "FR")!.routes
      .find((r) => r.id === "fr-ict")!;
    const closure = route.criteria.find((c) => "op" in c && c.op === "not-in") as
      { values: string[]; short_reason?: string };
    closure.values = ["ZZ"];
    delete closure.short_reason;
    const result = validateDataset(broken);
    expect(result.ok, "a closure naming an answer nothing can read was accepted").toBe(false);
    expect(JSON.stringify(result.errors)).toMatch(/ZZ/);
  });
});
