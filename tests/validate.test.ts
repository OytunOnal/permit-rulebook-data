import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertValidDataset, validateDataset } from "../src/validate.js";

const load = () =>
  JSON.parse(readFileSync(new URL("../data/de.json", import.meta.url), "utf8"));

describe("boundary validation (scenario step 6)", () => {
  it("the shipped dataset is valid", () => {
    expect(validateDataset(load()).ok).toBe(true);
  });

  it("a value stripped of its quote fails, naming the field", () => {
    const data = load();
    delete data.countries[0].routes[0].criteria[4].threshold.quote;
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    const relevant = result.errors.find((e) => e.message.includes("quote"));
    expect(relevant).toBeDefined();
    expect(relevant!.path).toContain("/countries/0/routes/0/criteria/4");
  });

  it("a non-https source is rejected", () => {
    const data = load();
    data.countries[0].routes[0].criteria[4].threshold.source_url = "http://insecure.example";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("assertValidDataset throws with the offending path in the message", () => {
    const data = load();
    delete data.countries[0].routes[1].criteria[3].threshold.retrieved_at;
    expect(() => assertValidDataset(data)).toThrowError(/countries\/0\/routes\/1/);
  });
});
