import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { deriveQuestions, fillRouteSlots, hostKindOf, subjectOf } from "../src/index.js";
import type { Dataset, FieldDef, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;
const routeOf = (d: Dataset, id: string): Route => d.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
const fieldOf = (d: Dataset, id: string): FieldDef => d.fields.find((f) => f.id === id)!;

/**
 * #159 — a question names a route through its slot, which says what the route is.
 *
 * A question that names a route writes `{route:<route id>}`, and the data
 * package fills it with the route's country, its plain name and the phrase the
 * route carries saying what it is. The gate forbids a route's plain name typed
 * into a question by hand; it demands nothing.
 */

/** #151's sentence for the spouse question (ruling 11). */
const SPOUSE_QUESTION =
  "Is your spouse or partner also applying for Germany's Opportunity Card — the permit to come and look for work — and eligible for one?";

describe("a route slot fills with the country's possessive, the route's plain name and what it is", () => {
  it("the Opportunity Card", () => {
    expect(fillRouteSlots("Applying for {route:de-chancenkarte}?", ds))
      .toBe("Applying for Germany's Opportunity Card — the permit to come and look for work?");
  });

  it("a name whose citation holds brackets of its own, in a country named with its article", () => {
    const written = clone();
    routeOf(written, "nl-researcher").what_it_is = "the permit for research at a recognised institution";
    expect(fillRouteSlots("{route:nl-researcher}", written))
      .toBe("the Netherlands' Researcher — the permit for research at a recognised institution");
  });

  it("text with no slot comes back as written", () => {
    expect(fillRouteSlots("Your age?", ds)).toBe("Your age?");
  });

  it("throws on a slot naming a route the dataset does not have, or one that does not say what it is", () => {
    expect(() => fillRouteSlots("{route:de-nothing}", ds)).toThrow(/de-nothing/);
    expect(() => fillRouteSlots("{route:de-researcher}", ds)).toThrow(/de-researcher/);
  });
});

describe("the spouse question names the card through its slot", () => {
  it("its label reads #151's sentence, filled", () => {
    const question = deriveQuestions(ds).find((q) => q.field === "partner_ck")!;
    expect(question.label).toBe(SPOUSE_QUESTION);
  });

  it("its subject is filled where a sentence names it", () => {
    expect(subjectOf(ds, "partner_ck")).not.toContain("{route:");
    expect(subjectOf(ds, "partner_ck")).toContain("Germany's Opportunity Card — the permit to come and look for work");
  });

  it("its learn link opens the card's own official page", () => {
    const learn = fieldOf(ds, "partner_ck").learn!;
    expect(learn.url).toBe(routeOf(ds, "de-chancenkarte").info_url);
    expect(hostKindOf(learn.url)).toBe("authority");
  });
});

describe("the gate: no question types a route's name outside a slot", () => {
  const slotErrors = (d: Dataset) =>
    validateDataset(d).errors.filter((e) => e.keyword === "routeNamedOutsideSlot" || e.keyword === "routeSlot");

  it("refuses a question that types the card's name by hand", () => {
    const bad = clone();
    fieldOf(bad, "partner_ck").label = "Is your spouse or partner also applying for an Opportunity Card?";
    expect(validateDataset(bad).ok).toBe(false);
    expect(slotErrors(bad).map((e) => e.message).join("\n")).toContain("Opportunity Card");
  });

  it("refuses the name typed into an option's words", () => {
    const bad = clone();
    fieldOf(bad, "partner_ck").options![0]!.short = "a partner applying for an Opportunity Card too";
    expect(slotErrors(bad).map((e) => e.path).join("\n")).toContain("/options/0/short");
  });

  it("refuses a slot naming a route the dataset does not have, or one that does not say what it is", () => {
    const bad = clone();
    fieldOf(bad, "partner_ck").label = "Applying for {route:de-nothing}?";
    fieldOf(bad, "german").subject = "your German level for {route:de-researcher}";
    const messages = slotErrors(bad).map((e) => e.message).join("\n");
    expect(messages).toContain("de-nothing");
    expect(messages).toContain("de-researcher");
  });

  it("refuses a slot where nothing fills it: in an option's words", () => {
    const bad = clone();
    fieldOf(bad, "partner_ck").options![0]!.label = "Yes, for {route:de-chancenkarte}";
    expect(slotErrors(bad).map((e) => e.path).join("\n")).toContain("/options/0/label");
  });

  it("passes the shipped dataset", () => {
    expect(slotErrors(ds)).toEqual([]);
    expect(validateDataset(ds).ok).toBe(true);
  });
});
