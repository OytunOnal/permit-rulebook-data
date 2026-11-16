import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bindsReader, evaluate, optionEquivalenceClasses, resultProvenance, routeStatements } from "../src/engine.js";
import { scopeLine, statedNotAsked } from "../src/scope.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset, Profile, Route, RouteStatement } from "../src/types.js";

const readJson = (p: string) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8").replace(/^﻿/, ""));

const dataset = readJson("../data/dataset.json") as Dataset;

const ORIENTATION_YEAR = "nl-orientation-year";
const TURKISH_CAVEAT = "turkish-citizens-differ";

const routeIn = (ds: Dataset, id: string): Route => ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
const routeOf = (id: string): Route => routeIn(dataset, id);
const turkishCaveat = (): RouteStatement =>
  routeStatements(routeOf(ORIENTATION_YEAR)).find((s) => s.id === TURKISH_CAVEAT)!;

const turkish: Profile = { destination: "nl", citizenship: "TR" };
const brazilian: Profile = { destination: "nl", citizenship: "BR" };
const undeclared: Profile = { destination: "nl" };

/**
 * A Passport-only statement: a route statement that names the only passports
 * it is about (OytunOnal/permit-rulebook#407). The IND's orientation-year page
 * says "different requirements may apply to Turkish citizens", and a reader who
 * declared another passport has no use for the sentence.
 */
describe("a Passport-only statement binds only the passports it names", () => {
  it("binds a Turkish reader and a reader with no passport declared, and not a Brazilian", () => {
    const caveat = turkishCaveat();
    expect(caveat.onlyFor?.citizenship).toEqual(["TR"]);
    expect(bindsReader(caveat, turkish)).toBe(true);
    expect(bindsReader(caveat, undeclared)).toBe(true);
    expect(bindsReader(caveat, brazilian)).toBe(false);
  });

  it("leaves the scope line's count of a reader it does not bind", () => {
    const route = routeOf(ORIENTATION_YEAR);
    const caveat = turkishCaveat();
    expect(statedNotAsked(route, { profile: turkish })).toContain(caveat.text);
    expect(statedNotAsked(route, { profile: brazilian })).not.toContain(caveat.text);
    const stated = (profile: Profile) => statedNotAsked(route, { split: true, profile }).stated.length;
    expect(stated(brazilian)).toBe(stated(turkish) - 1);
    const answeredBy = (profile: Profile) => scopeLine(route, { reader: "answered", profile });
    expect(answeredBy(brazilian)).not.toBe(answeredBy(turkish));
  });

  it("quotes its source on the card of a reader it binds, and not on another's", () => {
    const caveat = turkishCaveat();
    const quotesFor = (profile: Profile) => {
      const result = evaluate(dataset, profile).find((r) => r.route.id === ORIENTATION_YEAR)!;
      return resultProvenance(result, profile).map((e) => e.value.quote);
    };
    expect(quotesFor(turkish)).toContain(caveat.source!.quote);
    expect(quotesFor(brazilian)).not.toContain(caveat.source!.quote);
  });

  it("keeps a Turkish passport apart from a Brazilian one in the answer classes of the orientation year", () => {
    // The orientation year alone, so no other route or notice tells the two
    // passports apart.
    const ds = structuredClone(dataset);
    ds.countries = ds.countries
      .filter((c) => c.routes.some((r) => r.id === ORIENTATION_YEAR))
      .map((c) => ({ ...c, routes: c.routes.filter((r) => r.id === ORIENTATION_YEAR) }));
    ds.notices = [];
    const classes = optionEquivalenceClasses(ds, "citizenship", ["TR", "BR"]);
    expect(classes.map((c) => c.value)).toEqual(["TR", "BR"]);
  });
});

describe("the dataset check holds a Passport-only statement to the passports the interview offers", () => {
  const withOnlyFor = (onlyFor: unknown): Dataset => {
    const ds = structuredClone(dataset);
    routeIn(ds, "nl-ict").statements![0].onlyFor = onlyFor as RouteStatement["onlyFor"];
    return ds;
  };

  it("accepts one that names a passport the citizenship question offers", () => {
    expect(validateDataset(withOnlyFor({ citizenship: ["JP"] })).errors).toEqual([]);
  });

  it("refuses an empty passport list", () => {
    expect(validateDataset(withOnlyFor({ citizenship: [] })).ok).toBe(false);
  });

  it("refuses a passport the citizenship question does not offer, a class included", () => {
    for (const unknown of ["schengen_only", "third_country"]) {
      const result = validateDataset(withOnlyFor({ citizenship: ["JP", unknown] }));
      expect(result.ok, unknown).toBe(false);
      expect(result.errors.map((e) => e.message).join(" "), unknown).toContain(unknown);
    }
  });

  it("passes the shipped dataset", () => {
    expect(validateDataset(dataset).errors).toEqual([]);
  });
});
