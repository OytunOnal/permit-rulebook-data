import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { unlocks } from "../src/engine.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset, FieldDef, Profile } from "../src/types.js";

/**
 * OytunOnal/permit-rulebook#310, ruling 28: on each question a reader can
 * improve, the dataset marks the answers a reader can reach by acting
 * (`is_attainable`), so a step offers only those. "I don't know" is never one,
 * and the gate refuses an improvable question whose answers carry no mark.
 */

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const copy = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

/** The field with this id. Throws where the dataset has none. */
function fieldOf(ds: Dataset, id: string): FieldDef {
  const found = ds.fields.find((f) => f.id === id);
  if (!found) throw new Error(`precondition: the dataset asks ${id}`);
  return found;
}

/** What the gate says about a dataset, as "keyword at path". */
const gateSays = (ds: Dataset): string[] => validateDataset(ds).errors.map((e) => `${e.keyword} at ${e.path}`);

describe("the dataset marks the answers a reader can reach by acting", () => {
  it("each improvable question with answers of its own marks the ones a reader can reach, and no other answer carries the mark", () => {
    const marked = dataset.fields.flatMap((f) => (f.options ?? []).filter((o) => o.is_attainable).map((o) => `${f.id}=${o.value}`));
    expect(marked).toEqual([
      "qualification_recent=yes",
      "recognition_de=recognized",
      "recognition_de=partial",
      "experience_5y=2plus",
      "experience_7y=3to5",
      "experience_7y=5plus",
      "german=a1",
      "german=a2",
      "german=b1",
      "german=b2plus",
      "english=b2",
      "english=c1",
    ]);
  });

  it("the shipped dataset passes the gate with its marks", () => {
    const improvable = dataset.fields.filter((f) => f.kind === "improvable" && f.options);
    expect(improvable.length, "precondition: six improvable questions carry answers of their own").toBe(6);
    expect(gateSays(dataset)).toEqual([]);
  });

  it("every money step names an amount a reader can reach by acting", () => {
    const shortOnSalary: Profile = {
      destination: "de", citizenship: "third_country", situation: "offer", qualification: "degree",
      recognition_de: "recognized", occupation_shortage: "no", occupation_it: "no",
      experience_5y: "lt2", experience_7y: "lt3", salary_eur_year: "band_0",
    };
    const moneySteps = unlocks(dataset, shortOnSalary).filter((u) => u.field === "salary_eur_year");
    expect(moneySteps.length, "precondition: a salary step is offered").toBeGreaterThan(0);
    expect(moneySteps.map((u) => u.option.is_attainable)).toEqual(moneySteps.map(() => true));
  });
});

describe("the gate on the marks", () => {
  it("refuses an improvable question none of whose answers is marked", () => {
    const ds = copy();
    for (const o of fieldOf(ds, "recognition_de").options!) delete o.is_attainable;
    expect(gateSays(ds)).toContain("improvableMarksAttainable at /fields/recognition_de");
  });

  it("refuses \"I don't know\" marked as an answer a reader can reach", () => {
    const ds = copy();
    const unknown = fieldOf(ds, "recognition_de").options!.find((o) => o.is_unknown);
    expect(unknown, "precondition: recognition has an I-don't-know answer").toBeDefined();
    unknown!.is_attainable = true;
    expect(gateSays(ds)).toContain("unknownNeverAttainable at /fields/recognition_de");
  });

  it("the schema declares the mark: a boolean is accepted, anything else refused", () => {
    const ds = copy();
    const notAssessed = fieldOf(ds, "recognition_de").options!.find((o) => o.value === "not_assessed")!;
    notAssessed.is_attainable = false;
    expect(gateSays(ds)).toEqual([]);
    (notAssessed as unknown as Record<string, unknown>)["is_attainable"] = "yes";
    expect(validateDataset(ds).ok).toBe(false);
  });
});
