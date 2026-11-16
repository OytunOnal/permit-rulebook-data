import { describe, expect, it } from "vitest";
import { bindsReader, evaluate, optionEquivalenceClasses, resultProvenance, routeStatements } from "../src/engine.js";
import { scopeLine, statedNotAsked } from "../src/scope.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset, Profile, RouteStatement } from "../src/types.js";
import { readJson } from "./read-json.js";
import { routeOf } from "./route-of.js";

const dataset = readJson("../data/dataset.json") as Dataset;

// The route whose caveat the IND writes about Turkish passports alone.
const ORIENTATION_YEAR = "nl-orientation-year";
// That caveat: the shipped dataset's one Passport-only statement.
const TURKISH_CAVEAT = "turkish-citizens-differ";

const turkishCaveat = (): RouteStatement =>
  routeStatements(routeOf(dataset, ORIENTATION_YEAR)).find((s) => s.id === TURKISH_CAVEAT)!;

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
    expect(caveat.bindsOnly?.citizenship).toEqual(["TR"]);
    expect(bindsReader(caveat, turkish)).toBe(true);
    expect(bindsReader(caveat, undeclared)).toBe(true);
    expect(bindsReader(caveat, brazilian)).toBe(false);
  });

  it("leaves the scope line's count of a reader it does not bind", () => {
    const route = routeOf(dataset, ORIENTATION_YEAR);
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

  it("keeps a passport a carve-out names apart from one it does not, as for a Passport-only statement", () => {
    // OytunOnal/permit-rulebook#407, ruling 18: the Dutch provisional residence permit binds an Afghan
    // passport and not a Japanese one, and a Swiss passport and not an Austrian
    // one, so their cards differ.
    for (const pair of [["AF", "JP"], ["AT", "CH"]])
      expect(optionEquivalenceClasses(dataset, "citizenship", pair).map((c) => c.value), pair.join("/")).toEqual(pair);
  });
});

describe("the dataset check holds a Passport-only statement to the passports the interview offers", () => {
  const withBindsOnly = (bindsOnly: unknown): Dataset => {
    const ds = structuredClone(dataset);
    routeOf(ds, "nl-ict").statements![0].bindsOnly = bindsOnly as RouteStatement["bindsOnly"];
    return ds;
  };

  it("accepts one that names a passport the citizenship question offers", () => {
    expect(validateDataset(withBindsOnly({ citizenship: ["JP"] })).errors).toEqual([]);
  });

  it("refuses an empty passport list", () => {
    expect(validateDataset(withBindsOnly({ citizenship: [] })).ok).toBe(false);
  });

  it("refuses a passport the citizenship question does not offer, a class included", () => {
    for (const unoffered of ["schengen_only", "third_country"]) {
      const result = validateDataset(withBindsOnly({ citizenship: ["JP", unoffered] }));
      expect(result.ok, unoffered).toBe(false);
      expect(result.errors.map((e) => e.message).join(" "), unoffered).toContain(unoffered);
    }
  });

  it("refuses a statement that names both whom it leaves out and whom it is about", () => {
    // OytunOnal/permit-rulebook#407, ruling 17: a statement carries a carve-out or `bindsOnly`, never both.
    const ds = structuredClone(dataset);
    const sponsor = routeStatements(routeOf(ds, "nl-hsm-30plus")).find((s) => s.id === "employer-must-be-a-recognised-sponsor")!;
    expect(sponsor.except).toBeDefined();
    sponsor.bindsOnly = { citizenship: ["JP"] };
    const result = validateDataset(ds);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain("/countries/NL/routes/nl-hsm-30plus/statements/employer-must-be-a-recognised-sponsor");
  });

  it("passes the shipped dataset", () => {
    expect(validateDataset(dataset).errors).toEqual([]);
  });
});
