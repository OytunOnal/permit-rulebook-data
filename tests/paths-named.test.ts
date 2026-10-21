import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { criterionPhrase, deriveBands, evaluate, forEachCriterion, reasonFor } from "../src/index.js";
import { validateDataset } from "../src/validate.js";
import type { Criterion, Dataset, Profile, Route } from "../src/index.js";

/**
 * #155 (rulings 12–13 of #92): a criterion with paths is named in one line by
 * its own label, never by its paths joined into one run of "and"s and "or"s;
 * and a criterion that accepts a range of an ordered answer says the range in
 * one phrase of its own. Both are held by the gate.
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const copy = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

type Disjunction = Extract<Criterion, { op: "any" }>;

const routeIn = (ds: Dataset, id: string): Route => ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

/** Every criterion with paths in a dataset, nested ones included. */
function disjunctionsOf(ds: Dataset): Disjunction[] {
  const out: Disjunction[] = [];
  for (const route of ds.countries.flatMap((c) => c.routes))
    forEachCriterion(route.criteria, (c) => { if (c.op === "any") out.push(c); });
  return out;
}

/** The shortage Blue Card's choice between a recognised degree and IT experience. */
function degreeOrIt(ds: Dataset): Disjunction {
  const found = routeIn(ds, "de-blue-card-shortage").criteria.find((c): c is Disjunction =>
    c.op === "any" && c.paths.some((p) => p.criteria.some((pc) => "field" in pc && pc.field === "occupation_it")));
  if (!found) throw new Error("precondition: the shortage card has a degree-or-IT criterion");
  return found;
}

/** The IT path's experience rule on the shortage card. */
function itExperience(ds: Dataset): Extract<Criterion, { op: "in" }> {
  let found: Extract<Criterion, { op: "in" }> | undefined;
  forEachCriterion(degreeOrIt(ds).paths.flatMap((p) => p.criteria), (c) => {
    if (c.op === "in" && c.field === "experience_7y") found = c;
  });
  if (!found) throw new Error("precondition: the IT path reads experience_7y");
  return found;
}

/** What the gate says about a dataset, as "keyword at path: message". */
const gateSays = (ds: Dataset): string[] =>
  validateDataset(ds).errors.map((e) => `${e.keyword} at ${e.path}: ${e.message}`);

describe("#155 a criterion with paths is named by its label", () => {
  it("every criterion with paths and no short_reason of its own is named, in one line, by its label", () => {
    const named = disjunctionsOf(dataset).filter((c) => !c.short_reason);
    expect(named.length, "precondition: the dataset has criteria with paths to name").toBeGreaterThan(0);
    for (const c of named) expect(criterionPhrase(dataset, c)).toBe(c.label);
  });

  it("a reader the degree-or-IT criterion fails on every path is told it by the criterion's label", () => {
    const top = deriveBands(dataset, "salary_eur_year").at(-1)!.id;
    const reader: Profile = {
      destination: "de", citizenship: "IN", situation: "offer", qualification: "none",
      occupation_it: "no", salary_eur_year: top,
    };
    const r = evaluate(dataset, reader).find((x) => x.route.id === "de-blue-card-shortage")!;
    const choice = r.criteria.find((cr) => cr.criterion === degreeOrIt(dataset))!;
    expect(choice.outcome, "precondition: the criterion fails").toBe("fail");
    expect(choice.path, "precondition: no path decided it").toBeUndefined();
    const reason = reasonFor(dataset, r, reader);
    expect(reason.parts.needs).toEqual([degreeOrIt(dataset).label]);
    expect(reason.line).toContain(degreeOrIt(dataset).label);
  });
});

describe("#155 the gate: every criterion with paths, and every path, carries a label", () => {
  it("the shipped dataset passes", () => {
    expect(gateSays(dataset)).toEqual([]);
  });

  it("a path with no label fails", () => {
    const ds = copy();
    delete (degreeOrIt(ds).paths[1] as { label?: string }).label;
    expect(validateDataset(ds).ok).toBe(false);
    expect(gateSays(ds).join(" | "))
      .toMatch(/required at \/countries\/\d+\/routes\/\d+\/criteria\/\d+\/paths\/1: must have required property 'label'/);
  });

  it("a criterion with paths and no label fails", () => {
    const ds = copy();
    delete (degreeOrIt(ds) as { label?: string }).label;
    expect(validateDataset(ds).ok).toBe(false);
    expect(gateSays(ds).join(" | "))
      .toMatch(/required at \/countries\/\d+\/routes\/\d+\/criteria\/\d+: must have required property 'label'/);
  });

  it("an empty label is no label", () => {
    const ds = copy();
    degreeOrIt(ds).paths[0]!.label = "";
    expect(validateDataset(ds).ok).toBe(false);
    expect(gateSays(ds).join(" | ")).toMatch(/minLength at \/countries\/\d+\/routes\/\d+\/criteria\/\d+\/paths\/0\/label:/);
  });
});

describe("#155 the gate: a criterion accepting two or more rungs of an ordered answer carries a short_reason", () => {
  const RULE = "orderedRangeHasWords";

  it("the shortage card's IT experience rule without its short_reason fails", () => {
    const ds = copy();
    delete itExperience(ds).short_reason;
    expect(validateDataset(ds).ok).toBe(false);
    expect(gateSays(ds).join(" | ")).toContain(`${RULE} at /countries/DE/routes/de-blue-card-shortage`);
  });

  it("a question written here, marked ordered, fails a two-rung criterion with no short_reason", () => {
    const ds = copy();
    ds.fields.push({
      id: "ladder", label: "How high?", short_label: "Height", subject: "your height", type: "enum", ordered: true,
      options: [
        { value: "low", label: "Low", short: "a low rung" },
        { value: "mid", label: "Middle", short: "a middle rung" },
        { value: "top", label: "Top", short: "the top rung" },
      ],
    });
    routeIn(ds, "fr-talent-qualifie").criteria.push({ field: "ladder", op: "in", values: ["mid", "top"] });
    expect(gateSays(ds).join(" | ")).toContain(`${RULE} at /countries/FR/routes/fr-talent-qualifie`);
    routeIn(ds, "fr-talent-qualifie").criteria.at(-1)!.short_reason = "the middle rung or higher";
    expect(gateSays(ds)).toEqual([]);
  });

  it("one rung of an ordered answer needs no short_reason", () => {
    const ds = copy();
    const rule = itExperience(ds);
    delete rule.short_reason;
    rule.values = ["5plus"];
    expect(gateSays(ds)).toEqual([]);
  });

  it("two answers of a question not marked ordered need no short_reason", () => {
    const ds = copy();
    delete itExperience(ds).short_reason;
    for (const f of ds.fields) delete f.ordered;
    expect(gateSays(ds)).toEqual([]);
  });
});
