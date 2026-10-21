import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import { datasetMeta, forEachCriterion, notices, routeStatements } from "../src/engine.js";
import { hostKindOf } from "../src/hosts.js";
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
    // print verbatim beside the quote. A citation names the statute, nothing
    // about our fetcher; a mirror is disclosed by its host's kind (#158).
    for (const c of citations()) {
      expect(c.text, c.path).not.toMatch(/times out/);
      expect(c.text, c.path).not.toMatch(/from here/);
    }
  });

  it("the § 20a caveat still discloses the mirror, the way the § 21 citations do: its source is a consolidated text", () => {
    const route = ds.countries.flatMap((c) => c.routes).find((r) => r.id === "de-chancenkarte")!;
    const caveat = routeStatements(route).find((s) => s.source?.legal_basis?.startsWith("§ 20a Absatz 2"));
    expect(caveat, "the Opportunity Card's 20-hour caveat").toBeDefined();
    expect(hostKindOf(caveat!.source!.source_url)).toBe("consolidated-text");
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
  it("is stamped with the day of the latest data change", () => {
    // The day of the copy pass until s32 moved it on 2026-09-18 (nine
    // statements name their question), and #134 on 2026-10-21 (the shortage
    // card's IT path); the same-day convention keeps one stamp for every
    // change of a day.
    expect(datasetMeta(ds).dataset_version).toBe("2026.10.21");
    // Nothing was read at a source by the copy pass: two of our own sentences
    // moved. The newest read came later, with #134's IT path.
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-10-21");
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
    // in s25 when the experience ladder was split in two.) The shipped rule
    // says its range in its own short_reason, which the gate asks of a range
    // on an ordered question, so the composition is read without it.
    const { short_reason: _, ...composed } = inCriterion(routeOf("nl-blue-card"), "experience_7y");
    expect(composed.op).toBe("in");
    expect(criterionPhrase(ds, composed)).toBe("3 to under 5 or 5+ years of related experience in the last seven");
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

  const answered = { reader: "answered" } as const;

  it("counts in figures, and says who does not ask", () => {
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 2, noted: 0 }, answered))
      .toBe("quoted and dated · checked against your answers, except 2 conditions we don't ask about");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 1, noted: 0 }, answered))
      .toBe("quoted and dated · checked against your answers, except 1 condition we don't ask about");
  });

  it("a reading is in our own words, not the authority's", () => {
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 0, noted: 1 }, answered))
      .toBe("quoted and dated · checked against your answers, except 1 condition we don't ask about — 1 of them in our own words, not the authority's");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 0, noted: 2 }, answered))
      .toBe("quoted and dated · checked against your answers, except 2 conditions we don't ask about — 2 of them in our own words, not the authority's");
  });

  it("both at once: one count, and how many of them are ours", () => {
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 2, noted: 1 }, answered))
      .toBe("quoted and dated · checked against your answers, except 3 conditions we don't ask about — 1 of them in our own words, not the authority's");
  });

  it("no route's line carries the old words", () => {
    for (const route of ds.countries.flatMap((c) => c.routes)) {
      const line = scopeLine(route, { reader: "not-answered" });
      expect(line, route.id).not.toMatch(/stated but not asked|in our own reading/);
    }
    expect(scopeLine(routeOf("nl-blue-card"), { reader: "not-answered" }))
      .toBe("quoted and dated · the checker asks about it, except 3 conditions");
    expect(scopeLine(routeOf("fr-talent-qualifie"), { reader: "not-answered" }))
      .toBe("quoted and dated · the checker asks about it, except 1 condition — 1 of them in our own words, not the authority's");
  });
});
