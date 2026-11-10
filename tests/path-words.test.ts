import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { routeStatements } from "../src/engine.js";
import { disjunctionsOf } from "../src/path-words.js";
import { validateDataset } from "../src/validate.js";
import type { Disjunction } from "../src/disjunction.js";
import type { Dataset, Route, RouteStatement } from "../src/types.js";
import { routeOf } from "./route-of.js";

/**
 * OytunOnal/permit-rulebook#313 (rulings 2, 5 and 17 of #187 and #310): the
 * dataset gives each path of a criterion whose path a card names the words the
 * card says ("the IT-specialist path"), and a precondition that belongs to one
 * path names it by those words. The gate holds both.
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const copy = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

/** The route's criterion with paths whose label is `label`. Throws where it has none. */
function disjunctionOf(route: Route, label: string): Disjunction {
  const found = disjunctionsOf(route).find((c) => c.label === label);
  if (!found) throw new Error(`precondition: ${route.id} has a criterion with paths labelled "${label}"`);
  return found;
}

/** The route's statement with this id. Throws where it has none. */
function statementOf(route: Route, id: string): RouteStatement {
  const found = routeStatements(route).find((s) => s.id === id);
  if (!found) throw new Error(`precondition: ${route.id} has a statement "${id}"`);
  return found;
}

/** What the gate says about a dataset, as "keyword at path: message". */
const gateSays = (ds: Dataset): string[] =>
  validateDataset(ds).errors.map((e) => `${e.keyword} at ${e.path}: ${e.message}`);

/** The shortage Blue Card's choice between a recognised degree and IT experience. */
const degreeOrIt = (ds: Dataset): Disjunction =>
  disjunctionOf(routeOf(ds, "de-blue-card-shortage"), "recognised degree or IT experience");

describe("the dataset names the ways into a route", () => {
  it("the nine ways in carry words on every path, and no other criterion carries any (ruling 17)", () => {
    const marked = dataset.countries.flatMap((c) => c.routes).flatMap((route) =>
      disjunctionsOf(route).filter((c) => c.paths.some((p) => p.subject !== undefined)).map((c) => `${route.id}: ${c.label}`));
    expect(marked).toEqual([
      "de-blue-card-shortage: recognised degree or IT experience",
      "de-experienced-worker: qualification or IT experience",
      "de-chancenkarte: a recognised qualification, or points",
      "fr-talent-blue-card: diploma or experience",
      "es-blue-card: qualification or experience",
      "es-highly-qualified: qualification or experience",
      "es-ict: qualification or experience",
      "nl-blue-card: diploma or experience",
      "nl-orientation-year: where you studied",
    ]);
  });

  it("three preconditions name the path they belong to, and no other statement names one (ruling 5)", () => {
    const linked = dataset.countries.flatMap((c) => c.routes).flatMap((route) =>
      routeStatements(route).filter((s) => s.path !== undefined).map((s) => {
        const owner = disjunctionsOf(route).flatMap((c) => c.paths).find((p) => p.subject === s.path);
        return `${route.id}/${s.id} -> ${owner?.label}`;
      }));
    expect(linked).toEqual([
      "de-blue-card-shortage/academic-level-it-job -> IT specialist",
      "de-blue-card-shortage/federal-employment-agency-approval -> IT specialist",
      "nl-orientation-year/english-where-the-institution-was-abroad -> a foreign institution the Dutch immigration service designates",
    ]);
  });

  it("the shipped dataset passes the gate with its marks and links", () => {
    const routes = dataset.countries.flatMap((c) => c.routes);
    const marks = routes.flatMap(disjunctionsOf).filter((c) => c.paths.every((p) => p.subject !== undefined));
    const links = routes.flatMap(routeStatements).filter((s) => s.path !== undefined);
    expect([marks.length, links.length], "precondition: nine marked criteria and three linked statements").toEqual([9, 3]);
    expect(gateSays(dataset)).toEqual([]);
  });
});

describe("the gate on a path's words", () => {
  it("refuses a criterion where some paths carry words and some do not", () => {
    const ds = copy();
    delete degreeOrIt(ds).paths[1]!.subject;
    expect(gateSays(ds).join(" | "))
      .toContain("pathWordsOnEveryPath at /countries/DE/routes/de-blue-card-shortage");
  });

  it("refuses two paths of one route with the same words, which a link could not tell apart", () => {
    const ds = copy();
    const [degreePath, itPath] = degreeOrIt(ds).paths;
    degreePath!.subject = itPath!.subject;
    expect(gateSays(ds).join(" | "))
      .toContain("pathWordsDistinct at /countries/DE/routes/de-blue-card-shortage");
  });

  it("refuses words in quotation marks no source covers, like any label a card shows", () => {
    const ds = copy();
    degreeOrIt(ds).paths[1]!.subject = "the “specialist” path";
    expect(gateSays(ds).join(" | ")).toMatch(/quotedWithoutProvenance at \/countries\/DE\/routes\/de-blue-card-shortage\/criteria\/\d+\/paths\/1\/subject/);
  });
});

describe("the gate on a precondition's path", () => {
  it("refuses a link to a path the route does not have", () => {
    const ds = copy();
    // The points path's words exist in the dataset, on the Opportunity Card:
    // a link is held to its own route's paths.
    statementOf(routeOf(ds, "de-blue-card-shortage"), "academic-level-it-job").path = "the points path";
    expect(gateSays(ds).join(" | "))
      .toContain("knownStatementPath at /countries/DE/routes/de-blue-card-shortage/statements/academic-level-it-job/path");
  });

  it("refuses a link from a caveat, which binds no path", () => {
    const ds = copy();
    statementOf(routeOf(ds, "nl-orientation-year"), "turkish-citizens-differ").path = "the designated-foreign-institution path";
    expect(gateSays(ds).join(" | "))
      .toContain("statementPathOnPreconditionOnly at /countries/NL/routes/nl-orientation-year/statements/turkish-citizens-differ/path");
  });
});
