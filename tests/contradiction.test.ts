import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contradictionsIn, evaluate } from "../src/engine.js";
import { deriveQuestions } from "../src/questions.js";
import { proseProvenance, renderableTexts } from "../src/prose.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * A reader declared "no completed qualification" and, two questions later, that
 * she had graduated in the last three years. The engine took the graduation —
 * defensible — and handed her "1 route looks open · criteria met" with both
 * answers sitting in the sidebar, contradicting each other, unremarked
 * (isolated v1-gate critique, 2026-09-08, F7).
 *
 * A verdict resting on an answer the reader contradicted two screens earlier is
 * the one thing this product must never do quietly. The pairs that cannot both
 * be true are declared in the dataset, in the words a reader is shown, and the
 * screen says so.
 */

describe("two answers that cannot both be true are said out loud", () => {
  it("the dataset declares the pairs, in words and against real fields", () => {
    expect(dataset.contradictions?.length, "no pair is declared at all").toBeGreaterThan(0);
    const fields = new Set(dataset.fields.map((f) => f.id));
    for (const pair of dataset.contradictions!) {
      expect(pair.when.length, `${pair.id}: a pair needs two sides`).toBeGreaterThanOrEqual(2);
      for (const side of pair.when) {
        expect(fields.has(side.field), `${pair.id}: no field ${side.field}`).toBe(true);
        const known = new Set(
          deriveQuestions(dataset).find((q) => q.field === side.field)!.options.map((o) => o.value),
        );
        for (const value of side.in)
          expect(known.has(value), `${pair.id}: ${side.field} has no answer ${value}`).toBe(true);
      }
      // A sentence, in the reader's own terms.
      expect(pair.say, pair.id).toMatch(/^[A-Z]/);
      expect(pair.say, pair.id).toMatch(/[.!?]$/);
      expect(pair.say, pair.id).not.toMatch(/[a-z_]+_[a-z_]+/);
    }
  });

  it("the critique's own walk is caught", () => {
    const walk: Profile = {
      destination: "nl", citizenship: "third_country", situation: "offer",
      qualification: "none", nl_recent_grad: "no", top200_grad: "yes",
    };
    const said = contradictionsIn(dataset, walk);
    expect(said.length, "the pair that shipped a green verdict is not caught").toBeGreaterThan(0);
    expect(said[0]!.say).toContain("qualification");
    // And the route that rested on it is still evaluated — this says something
    // about the answers, it does not change the rules.
    expect(evaluate(dataset, walk).find((r) => r.route.id === "nl-orientation-year")).toBeDefined();
  });

  it("says nothing when the answers agree, or when one of them is missing", () => {
    const consistent: Profile = {
      destination: "nl", citizenship: "third_country", situation: "offer",
      qualification: "degree", nl_recent_grad: "no", top200_grad: "yes",
    };
    expect(contradictionsIn(dataset, consistent)).toEqual([]);
    // Half-answered: an interview in progress is not a contradiction.
    expect(contradictionsIn(dataset, { qualification: "none" })).toEqual([]);
    expect(contradictionsIn(dataset, {})).toEqual([]);
  });

  it("never fires twice for the same pair, whatever the order of the answers", () => {
    const walk: Profile = {
      destination: "nl", citizenship: "third_country", situation: "offer",
      qualification: "none", nl_recent_grad: "yes", top200_grad: "yes",
    };
    const ids = contradictionsIn(dataset, walk).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/**
 * The schema knows the shape of a field name, not which fields exist. A pair
 * that names a field or an answer nobody has can never fire, and an
 * unreachable warning is worse than none — it looks like the screen is
 * watching when it is not (Standards review, 2026-09-08).
 */
describe("a pair that could never fire fails the build", () => {
  const wreck = (change: (d: Dataset) => void): string[] => {
    const copy = JSON.parse(JSON.stringify(dataset)) as Dataset;
    change(copy);
    return validateDataset(copy).errors.map((e) => `${e.keyword}: ${e.message}`);
  };

  it("the shipped dataset is clean", () => {
    expect(validateDataset(dataset).ok).toBe(true);
  });

  it("a field id nobody has is caught", () => {
    const said = wreck((d) => { d.contradictions![0]!.when[0]!.field = "qualifikation"; });
    expect(said.join(" | ")).toContain("knownContradictionField");
  });

  it("an answer nobody can give is caught", () => {
    const said = wreck((d) => { d.contradictions![0]!.when[0]!.in = ["nope"]; });
    expect(said.join(" | ")).toContain("knownContradictionAnswer");
  });

  it("a money field's third door is a real answer, not a typo", () => {
    const said = wreck((d) => {
      d.contradictions!.push({
        id: "money-door",
        when: [
          { field: "funds_eur_month", in: ["unknown"] },
          { field: "qualification", in: ["none"] },
        ],
        say: "A sentence long enough to pass the schema, said in words.",
      });
    });
    expect(said.filter((e) => e.includes("Contradiction"))).toEqual([]);
  });
});

/**
 * Reader-facing prose that no gate could see is prose nobody is checking. The
 * sentence a contradiction shows is ours — no authority says it — so it is
 * declared ours, checked for quotation marks it cannot back, and counted with
 * the rest of our prose (Standards review, 2026-09-08).
 */
describe("the sentence is inside the prose gate", () => {
  it("every pair's words are declared ours and reach the gate", () => {
    const texts = renderableTexts(dataset);
    for (const pair of dataset.contradictions!) {
      const seen = texts.find((t) => t.text === pair.say);
      expect(seen, `${pair.id}: its sentence reaches no gate`).toBeDefined();
      expect(seen!.kind, pair.id).toBe("ours");
      expect(seen!.path, pair.id).toContain("/contradictions/");
    }
  });

  it("and they are counted, so the measurement moves when the data does", () => {
    const before = proseProvenance(dataset).ours;
    const more = JSON.parse(JSON.stringify(dataset)) as Dataset;
    more.contradictions!.push({
      id: "another-pair", when: dataset.contradictions![0]!.when,
      say: "A second pair, said in words long enough for the schema.",
    });
    expect(proseProvenance(more).ours).toBe(before + 1);
  });
});
