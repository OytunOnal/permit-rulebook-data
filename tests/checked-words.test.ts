import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { renderableTexts, scopeLine, scopeWords, SCOPE_VALUES } from "../src/index.js";
import type { Dataset, Route } from "../src/index.js";

const ds = dataset as unknown as Dataset;
const routeOf = (id: string): Route =>
  ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

/**
 * GLOSSARY's Scope statement avoid-list: the model's words, kept in code and on
 * `/data/`, never in front of a reader (#151).
 */
const SCOPE_STATEMENT_AVOID_LIST = ["scored", "this interview", "rule set"] as const;
const avoidListWordsIn = (text: string): string[] =>
  SCOPE_STATEMENT_AVOID_LIST.filter((word) => text.toLowerCase().includes(word));

/**
 * #153 — the scope line has two forms, chosen by whether the reader has
 * answered: the results card says what the route was checked against, a page
 * with no answers says what the checker asks (#151, rulings 3 and 17 of #92).
 */
describe("#153 — the scope line in the reader's words", () => {
  it("where the reader has answered, the route was checked against their answers", () => {
    const answered = { reader: "answered" } as const;
    expect(scopeWords("every-deciding-rule-asked", { stated: 0, noted: 0 }, answered))
      .toBe("quoted and dated · checked against your answers");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 2, noted: 0 }, answered))
      .toBe("quoted and dated · checked against your answers, except 2 conditions we don't ask about");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 1, noted: 1 }, answered))
      .toBe("quoted and dated · checked against your answers, except 2 conditions we don't ask about — 1 of them in our own words, not the authority's");
    expect(scopeWords("rules-quoted-nothing-asked", { stated: 0, noted: 0 }, answered))
      .toBe("quoted and dated · not checked against your answers");
  });

  it("where the reader has answered nothing, the line says what the checker asks", () => {
    const notAnswered = { reader: "not-answered" } as const;
    expect(scopeWords("every-deciding-rule-asked", { stated: 0, noted: 0 }, notAnswered))
      .toBe("quoted and dated · the checker asks about all of it");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 1, noted: 0 }, notAnswered))
      .toBe("quoted and dated · the checker asks about it, except 1 condition");
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 0, noted: 2 }, notAnswered))
      .toBe("quoted and dated · the checker asks about it, except 2 conditions — 2 of them in our own words, not the authority's");
    expect(scopeWords("rules-quoted-nothing-asked", { stated: 0, noted: 0 }, notAnswered))
      .toBe("quoted and dated · the checker does not ask about it");
  });

  it("a route whose unasked conditions are all set aside reads as the first form, in either", () => {
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 0, noted: 0 }, { reader: "answered" }))
      .toBe(scopeWords("every-deciding-rule-asked", { stated: 0, noted: 0 }, { reader: "answered" }));
    expect(scopeWords("some-conditions-stated-not-asked", { stated: 0, noted: 0 }, { reader: "not-answered" }))
      .toBe(scopeWords("every-deciding-rule-asked", { stated: 0, noted: 0 }, { reader: "not-answered" }));
  });

  it("a shipped route's line counts its own readings, in the form the caller asks for", () => {
    // fr-talent-qualifie: no stated condition left unasked, one reading.
    const route = routeOf("fr-talent-qualifie");
    expect(scopeLine(route, { reader: "not-answered" }))
      .toBe("quoted and dated · the checker asks about it, except 1 condition — 1 of them in our own words, not the authority's");
    expect(scopeLine(route, { reader: "answered", profile: { citizenship: "IN" } }))
      .toBe("quoted and dated · checked against your answers, except 1 condition we don't ask about — 1 of them in our own words, not the authority's");
  });

  it("no scope line, in either form, carries a word on the Scope statement's avoid-list", () => {
    for (const value of SCOPE_VALUES)
      for (const reader of ["answered", "not-answered"] as const)
        for (const unasked of [{ stated: 0, noted: 0 }, { stated: 2, noted: 0 }, { stated: 2, noted: 1 }]) {
          const line = scopeWords(value, unasked, { reader });
          expect(avoidListWordsIn(line), line).toEqual([]);
        }
  });

  it("no text the dataset puts in front of a reader carries a word on the avoid-list", () => {
    const offending = renderableTexts(ds)
      .filter((t) => avoidListWordsIn(t.text).length > 0)
      .map((t) => `${t.path}: ${avoidListWordsIn(t.text).join(", ")}`);
    expect(offending).toEqual([]);
  });
});
