import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertValidDataset, validateDataset } from "../src/validate.js";

const load = () =>
  JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));

describe("boundary validation (scenario step 6)", () => {
  it("the shipped dataset is valid", () => {
    const result = validateDataset(load());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("a value stripped of its quote fails, naming the field", () => {
    const data = load();
    // de-blue-card-shortage → salary criterion (last one) → threshold
    delete data.countries[0].routes[0].criteria.at(-1).threshold.quote;
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("quote"))).toBe(true);
  });

  it("a non-https source is rejected", () => {
    const data = load();
    data.countries[0].routes[0].criteria.at(-1).threshold.source_url = "http://insecure.example";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("assertValidDataset names the deepest offending path", () => {
    const data = load();
    delete data.countries[0].routes[1].criteria.at(-1).threshold.retrieved_at;
    expect(() => assertValidDataset(data)).toThrowError(/threshold.*retrieved_at|retrieved_at/);
  });

  it("a points table stripped of its source fails", () => {
    const data = load();
    const ck = data.countries[0].routes.find((r: { id: string }) => r.id === "de-chancenkarte");
    const anyC = ck.criteria.at(-1);
    delete anyC.paths[1].criteria[0].table.source_url;
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a duplicate route id across countries fails (review catch: Maps key by id)", () => {
    const data = load();
    const clone = structuredClone(data.countries[3].routes[0]);
    data.countries[1].routes.push(clone); // NL route id smuggled under FR
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "uniqueRouteId")).toBe(true);
  });

  it("a restated threshold that drifts from its twin fails (review catch: NL ICT restates HSM amounts)", () => {
    const data = load();
    const nlIct = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-ict");
    const anyC = nlIct.criteria.at(-1); // HSM-salary-by-age disjunction
    anyC.paths[0].criteria[1].threshold.retrieved_at = "2026-01-01"; // one copy updated, twin missed
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "thresholdConsistency")).toBe(true);
  });
});

describe("s5b — notices and preconditions are data, not prose (schema boundary)", () => {
  it("a notice stripped of its quote fails", () => {
    const data = load();
    delete data.notices[0].source.quote;
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("quote"))).toBe(true);
  });

  it("an empty precondition string fails — every line must say something", () => {
    const data = load();
    const nl = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-hsm-30plus");
    nl.preconditions = ["The employer is an IND-recognised sponsor", ""];
    expect(validateDataset(data).ok).toBe(false);
  });

  it("preconditions must be strings, not structured objects", () => {
    const data = load();
    const nl = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-hsm-30plus");
    nl.preconditions = [{ text: "BIG registration" }];
    expect(validateDataset(data).ok).toBe(false);
  });
});

/**
 * The provenance rule is that every value carries a source URL, a verbatim
 * quote and a retrieval date TO EXIST. `unsourced` is the one exception, and it
 * shipped as a text box with a minimum length: eleven characters of anything
 * satisfied it, which made the gate optional by prose (review 2026-09-07). The
 * genesis rule is never require content, require a DECISION — so the exception
 * is an attributable one: a reason a gate can read, and a date a human can age.
 */
describe("an absent quote is a decision, not an essay", () => {
  const statementOf = (data: any) =>
    data.countries.flatMap((c: any) => c.routes).find((r: any) => r.id === "es-blue-card").statements[0];

  it("prose alone fails, however much of it there is", () => {
    const data = load();
    statementOf(data).unsourced =
      "The ministry publishes this only as a scan, and we checked again on 2026-09-07.";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("prose without a reason fails — the note is in addition, never instead", () => {
    const data = load();
    statementOf(data).unsourced = { note: "We looked hard and could not find it anywhere at all." };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason we did not enumerate fails — a gate can only read a fixed set", () => {
    const data = load();
    statementOf(data).unsourced = { reason: "we-ran-out-of-time", checked_at: "2026-09-07" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason with no checked-on date fails — nothing a human can age", () => {
    const data = load();
    statementOf(data).unsourced = { reason: "scanned-image" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("the date is held to the shape the sourced side is held to", () => {
    const data = load();
    statementOf(data).unsourced = { reason: "scanned-image", checked_at: "7 September 2026" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason and a date, with or without a note, is what passes", () => {
    const data = load();
    statementOf(data).unsourced = { reason: "unreachable", checked_at: "2026-09-07" };
    expect(validateDataset(data).errors).toEqual([]);
    statementOf(data).unsourced = {
      reason: "not-published-in-words", checked_at: "2026-09-07", note: "The list is a PDF table.",
    };
    expect(validateDataset(data).errors).toEqual([]);
  });

  it("a statement may still not carry both a quote and a reason not to have one", () => {
    const data = load();
    const s = statementOf(data);
    s.source = { source_url: "https://example.es/x", quote: "Some official wording.", retrieved_at: "2026-09-07" };
    expect(validateDataset(data).ok).toBe(false);
  });
});
