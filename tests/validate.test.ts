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
});
