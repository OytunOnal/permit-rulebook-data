import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import { datasetMeta, forEachCriterion, notices } from "../src/engine.js";
import { scopeLine, scopeWords } from "../src/scope.js";
import { criterionPhrase } from "../src/verdict.js";
import { renderableTexts } from "../src/prose.js";
import type { Watchlist } from "../src/watch/core.js";
import type { Criterion, Dataset, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));
const watchlist = readJson(new URL("../watch/watchlist.json", import.meta.url)) as Watchlist;

/**
 * s23 — the copy pass, data half.
 *
 * The v1.1 walk read every user-facing string away from the screen. Two of
 * its findings are sentences the dataset ships, not the site: a notice that
 * names a route the reader may not have on their screen (P7), and a source
 * citation carrying a curator's remark about our own fetcher (P3). Both are
 * data changes; the site prints what it is given.
 */
describe("s23 P7 — the Türkiye notice names no route", () => {
  const notice = () => ds.notices!.find((n) => n.id === "tr-ankara-rights")!;

  it("ends where the rule ends: the card that differs says so, and no route is named", () => {
    // Until 2026-09-17 the body ended "…that route's card says so — the Dutch
    // orientation year is one." A Germany-only reader was sent to a card not
    // on their screen (v1.1 critique P7; human: "kaldır"). A reader who
    // reaches such a card sees the difference there.
    expect(notice().body.endsWith("that route's card says so.")).toBe(true);
    expect(notice().body).not.toMatch(/orientation year/i);
    expect(notice().body).not.toMatch(/Dutch/);
  });

  it("is the sentence a Turkish passport reads for Germany, unchanged otherwise", () => {
    const shown = notices(ds, { destination: "de", citizenship: "TR", situation: "offer" });
    expect(shown.map((n) => n.id)).toEqual(["tr-ankara-rights"]);
    // The rest of the body stands: the agreement adds rights, not a way in.
    expect(shown[0].body).toContain("adds rights once you are legally working");
    // Our sentence, not the authority's: the quote and its read date stay.
    expect(shown[0].source.retrieved_at).toBe("2026-09-04");
    expect(shown[0].source.history).toEqual([]);
  });
});

describe("s23 P3 — the curator's note leaves the card", () => {
  /** Every citation the site prints beside a quote. */
  const citations = () => renderableTexts(ds).filter((t) => t.path.endsWith("/legal_basis"));

  it("no citation a card prints is about us", () => {
    // "(consolidated mirror — gesetze-im-internet.de times out from here)"
    // sat in the § 20a caveat's legal_basis, which card.ts and route-page.ts
    // print verbatim beside the quote. A citation names the statute and,
    // where the read is a mirror, discloses that — nothing about our fetcher.
    for (const c of citations()) {
      expect(c.text, c.path).not.toMatch(/times out/);
      expect(c.text, c.path).not.toMatch(/from here/);
    }
  });

  it("the § 20a caveat still discloses the mirror, the way the § 21 citations do", () => {
    const caveat = citations().find((c) => c.path.includes("de-chancenkarte") && c.text.startsWith("§ 20a Absatz 2"));
    expect(caveat, "the Opportunity Card's 20-hour caveat citation").toBeDefined();
    expect(caveat!.text).toBe("§ 20a Absatz 2 AufenthG (consolidated mirror, buzer.de)");
  });

  it("the note stays in the data: on the watch entry for the source it is about", () => {
    // The watchlist entry's `note` is where CONTRIBUTING puts "what the fetch
    // actually did, with the day you measured it" — curator-only, read by the
    // watch, rendered nowhere.
    const entry = watchlist.entries.find((e) => e.url === "https://www.buzer.de/20a_AufenthG.htm")!;
    expect(entry.note).toMatch(/gesetze-im-internet\.de times out/);
    expect(entry.note).toMatch(/consolidated mirror/);
  });
});

describe("s23 — the dataset says so in its version", () => {
  it("is stamped with the day of the copy pass", () => {
    expect(datasetMeta(ds).dataset_version).toBe("2026.09.17");
    // Nothing was read at a source by the copy pass: two of our own sentences
    // moved. The day's newest read came later, with s29's two free-movement
    // sentences.
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-09-17");
  });
});

describe("s23 P2 — a rule with two limbs is one sentence", () => {
  const routeOf = (id: string): Route => ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
  const inCriterion = (route: Route, field: string): Criterion => {
    let found: Criterion | undefined;
    forEachCriterion(route.criteria, (c) => { if (c.op === "in" && c.field === field && !found) found = c; });
    return found!;
  };

  it("factors the shared tail once: the Dutch IT experience rule reads as one phrase", () => {
    // Read from the dataset's own options: "3 to under 5 years of related
    // experience in the last seven" and "5+ years of related experience in
    // the last seven" share everything after the head. Until s23 a two-limb
    // rule's condition line, heading and "Needs …" line all read the option
    // list out in full. (The rule this was first proved on, the experienced
    // worker's "2+ or 5+ years of related experience", became a one-limb rule
    // in s25 when the experience ladder was split in two.)
    const c = inCriterion(routeOf("nl-blue-card"), "experience_7y");
    expect(c.op).toBe("in");
    expect(criterionPhrase(ds, c)).toBe("3 to under 5 or 5+ years of related experience in the last seven");
  });

  it("leaves a rule whose options share no tail exactly as it was", () => {
    const fabricated = {
      ...ds,
      fields: [{
        id: "shape", label: "Shape?", short_label: "shape", subject: "the shape", type: "enum",
        options: [
          { value: "a", label: "A", short: "a round thing" },
          { value: "b", label: "B", short: "a square box" },
        ],
      }, ...ds.fields],
    } as Dataset;
    const c: Criterion = { field: "shape", op: "in", values: ["a", "b"] };
    expect(criterionPhrase(fabricated, c)).toBe("a round thing or a square box");
  });

  it("a one-word tail is not a shared phrase, and a whole-phrase tail is", () => {
    const fabricated = {
      ...ds,
      fields: [{
        id: "shape", label: "Shape?", short_label: "shape", subject: "the shape", type: "enum",
        options: [
          { value: "a", label: "A", short: "a red box" },
          { value: "b", label: "B", short: "a blue box" },
          { value: "c", label: "C", short: "recognised qualification" },
          { value: "d", label: "D", short: "vocational qualification" },
        ],
      }, ...ds.fields],
    } as Dataset;
    // "box" alone is one word — the heads would be "a red" and "a blue",
    // which no reader would say. Unchanged.
    expect(criterionPhrase(fabricated, { field: "shape", op: "in", values: ["a", "b"] }))
      .toBe("a red box or a blue box");
    // The whole phrase minus a leading token is a tail, even at one word.
    expect(criterionPhrase(fabricated, { field: "shape", op: "in", values: ["c", "d"] }))
      .toBe("recognised or vocational qualification");
  });

  it("a short_reason still wins over the composed phrase", () => {
    const c = inCriterion(routeOf("es-highly-qualified"), "experience_7y");
    expect(c.short_reason).toBeDefined();
    expect(criterionPhrase(ds, c)).toBe(c.short_reason);
  });
});

describe("s23 P4 — the scope line speaks the reader's language", () => {
  const routeOf = (id: string): Route => ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

  it("counts in figures, after a dash, and says who did not ask", () => {
    expect(scopeWords("some-conditions-stated-not-asked", 2, 0))
      .toBe("quoted and dated · scored — 2 conditions this interview did not ask");
    expect(scopeWords("some-conditions-stated-not-asked", 1, 0))
      .toBe("quoted and dated · scored — 1 condition this interview did not ask");
  });

  it("a reading is in our own words, not the authority's", () => {
    expect(scopeWords("some-conditions-stated-not-asked", 0, 1))
      .toBe("quoted and dated · scored — 1 condition this interview did not ask, in our own words, not the authority's");
    expect(scopeWords("some-conditions-stated-not-asked", 0, 2))
      .toBe("quoted and dated · scored — 2 conditions this interview did not ask, in our own words, not the authority's");
  });

  it("both at once, joined with and", () => {
    expect(scopeWords("some-conditions-stated-not-asked", 2, 1))
      .toBe("quoted and dated · scored — 2 conditions this interview did not ask and 1 condition in our own words, not the authority's");
  });

  it("the two lines that did not change did not change", () => {
    expect(scopeWords("every-deciding-rule-asked", 0, 0)).toBe("quoted and dated · scored against your answers");
    expect(scopeWords("rules-quoted-nothing-asked", 0, 0)).toBe("quoted and dated · not scored");
    expect(scopeWords("some-conditions-stated-not-asked", 0, 0)).toBe("quoted and dated · scored against your answers");
  });

  it("no route's line carries the old words", () => {
    for (const route of ds.countries.flatMap((c) => c.routes)) {
      const line = scopeLine(route);
      expect(line, route.id).not.toMatch(/stated but not asked|in our own reading/);
    }
    expect(scopeLine(routeOf("nl-blue-card"))).toBe("quoted and dated · scored — 3 conditions this interview did not ask");
    expect(scopeLine(routeOf("fr-talent-qualifie")))
      .toBe("quoted and dated · scored — 1 condition this interview did not ask, in our own words, not the authority's");
  });
});
