import { describe, expect, it } from "vitest";
import { evaluate, informativeFields } from "../src/engine.js";
import { remainingQuestions } from "../src/questions.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset } from "../src/types.js";

// Chancenkarte-shaped fixture: independent of live curation data so these
// tests stay green regardless of dataset contents.
const PROV = {
  source_url: "https://example.gov.de/points",
  quote: "mindestens sechs Punkte erforderlich",
  retrieved_at: "2026-09-02",
};
const fixture: Dataset = {
  schema_version: "0.1.0",
  dataset_version: "test",
  fields: [
    { id: "citizenship", label: "Citizenship?", type: "enum", options: [
      { value: "eu", label: "EU" }, { value: "third", label: "Third country" } ] },
    { id: "qualification", label: "Qualification?", type: "enum", options: [
      { value: "none", label: "None" }, { value: "vocational", label: "Vocational" }, { value: "degree", label: "Degree" } ] },
    { id: "experience", label: "Experience?", type: "enum", options: [
      { value: "lt2", label: "<2y" }, { value: "y2to5", label: "2-5y" }, { value: "gt5", label: ">5y" } ] },
    { id: "german", label: "German level?", type: "enum", options: [
      { value: "none", label: "None" }, { value: "a2", label: "A2" }, { value: "b1", label: "B1+" },
      { value: "unknown", label: "Don't know", is_unknown: true } ] },
    { id: "age", label: "Age?", type: "enum", options: [
      { value: "u35", label: "<35" }, { value: "b35_40", label: "35-40" }, { value: "o40", label: ">40" } ] },
  ],
  countries: [{
    code: "DE", name: "Germany",
    routes: [{
      id: "de-points-card",
      name: "Points card",
      kind: "seek",
      info_url: "https://example.gov.de/route",
      criteria: [
        { field: "citizenship", op: "eq", value: "third" },
        { field: "qualification", op: "eq", value: "degree" },
        {
          op: "points",
          required: { value: 6, unit: "points", ...PROV },
          table: {
            ...PROV,
            items: [
              { field: "experience", points: { y2to5: 2, gt5: 3 } },
              { field: "german", points: { a2: 1, b1: 2 } },
              { field: "age", points: { u35: 2, b35_40: 1 } },
            ],
          },
        },
      ],
    }],
  }],
};

const base = { citizenship: "third", qualification: "degree" };

describe("points criterion", () => {
  it("the fixture passes schema validation (points branch)", () => {
    expect(validateDataset(JSON.parse(JSON.stringify(fixture))).ok).toBe(true);
  });

  it("scores and passes: 3+2+2 = 7 of 6, with breakdown", () => {
    const [r] = evaluate(fixture, { ...base, experience: "gt5", german: "b1", age: "u35" });
    expect(r.status).toBe("met");
    expect(r.points).toEqual({
      scored: 7, required: 6,
      items: [
        { field: "experience", points: 3 },
        { field: "german", points: 2 },
        { field: "age", points: 2 },
      ],
    });
  });

  it("fully answered but short → near with an honest points gap", () => {
    const [r] = evaluate(fixture, { ...base, experience: "y2to5", german: "a2", age: "o40" });
    expect(r.status).toBe("near");
    expect(r.gap_points).toBe(3); // 6 - (2+1+0)
  });

  it("shortfall decides only when the ladder is complete — full score shown, exact gap", () => {
    const partial = { ...base, experience: "lt2", german: "none" };
    // age still unanswered → criterion stays open, age still asked
    expect(remainingQuestions(fixture, partial).map((q) => q.field)).toEqual(["age"]);
    const [r] = evaluate(fixture, { ...partial, age: "o40" });
    expect(r.status).toBe("near");
    expect(r.gap_points).toBe(6);
    expect(r.points).toMatchObject({ scored: 0, required: 6 });
  });

  it("stops asking point items once the requirement is already met", () => {
    const answers = { ...base, experience: "gt5", german: "b1" }; // 5... wait 3+2=5 <6
    const withAge = { ...answers, age: "u35" }; // 7 ≥ 6
    expect(remainingQuestions(fixture, answers).map((q) => q.field)).toEqual(["age"]);
    expect(remainingQuestions(fixture, withAge)).toEqual([]);
  });

  it("'unknown' answers neither score nor kill: criterion stays undecided", () => {
    const fields = informativeFields(fixture, { ...base, experience: "y2to5", german: "unknown" });
    expect(fields.has("age")).toBe(true); // still winnable via age
  });
});

describe("any-of paths (§20a shape: direct OR points)", () => {
  const anyFixture: Dataset = JSON.parse(JSON.stringify(fixture));
  anyFixture.fields.push({ id: "recognized", label: "Fully recognised?", type: "enum", options: [
    { value: "yes", label: "Yes" }, { value: "no", label: "No" } ] });
  anyFixture.countries[0].routes[0].criteria = [
    { field: "citizenship", op: "eq", value: "third" },
    {
      op: "any",
      paths: [
        { label: "direct", criteria: [{ field: "recognized", op: "eq", value: "yes" }] },
        { label: "points", criteria: [
          { field: "qualification", op: "in", values: ["vocational", "degree"] },
          (fixture.countries[0].routes[0].criteria[2] as Extract<Dataset["countries"][0]["routes"][0]["criteria"][0], { op: "points" }>),
        ] },
      ],
    },
  ];

  it("validates against the schema (in + any branches)", () => {
    expect(validateDataset(JSON.parse(JSON.stringify(anyFixture))).ok).toBe(true);
  });

  it("direct path passing decides the route — points questions are never asked", () => {
    const profile = { citizenship: "third", recognized: "yes" };
    const [r] = evaluate(anyFixture, profile);
    expect(r.status).toBe("met");
    expect(remainingQuestions(anyFixture, profile)).toEqual([]);
  });

  it("direct path failing falls through to the points path", () => {
    const profile = { citizenship: "third", recognized: "no", qualification: "degree" };
    const remaining = remainingQuestions(anyFixture, profile).map((q) => q.field);
    expect(remaining).toEqual(expect.arrayContaining(["experience", "german", "age"]));
    const done = evaluate(anyFixture, { ...profile, experience: "gt5", german: "b1", age: "u35" });
    expect(done[0].status).toBe("met");
    expect(done[0].points?.scored).toBe(7);
  });

  it("both paths dead → route dead, no questions", () => {
    const profile = { citizenship: "third", recognized: "no", qualification: "none" };
    const [r] = evaluate(anyFixture, profile);
    expect(r.status).toBe("hold");
    expect(remainingQuestions(anyFixture, profile)).toEqual([]);
  });
});

describe("information-gain ordering", () => {
  it("asks the most eliminating question first", () => {
    // qualification: 2 of 3 answers kill the route (avg 1/3 alive) beats
    // citizenship's 1 of 2 (avg 1/2) — the metric, not field order, decides.
    const order = remainingQuestions(fixture, {}).map((q) => q.field);
    expect(order[0]).toBe("qualification");
    expect(order.indexOf("citizenship")).toBeLessThan(order.indexOf("experience"));
  });

  it("recomputes adaptively: the ladder completes, then nothing remains", () => {
    expect(remainingQuestions(fixture, { ...base, experience: "lt2", german: "none" }).map((q) => q.field))
      .toEqual(["age"]);
    expect(remainingQuestions(fixture, { ...base, experience: "lt2", german: "none", age: "o40" }))
      .toEqual([]);
  });
});
