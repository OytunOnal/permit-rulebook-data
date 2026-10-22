import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateDataset } from "../src/validate.js";

const load = () => JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));

/** The situation question's options in a copied dataset, to break or reorder in a test. */
const situationOptionsOf = (data: { fields: { id: string; options?: Record<string, unknown>[] }[] }) =>
  data.fields.find((f) => f.id === "situation")!.options!;

describe("an arranged answer is a mark the schema declares", () => {
  it("a boolean is_arranged is accepted and a non-boolean one is refused", () => {
    const data = load();
    const offer = situationOptionsOf(data).find((o) => !o["is_arranged"] && !o["is_fallback"])!;
    offer["is_arranged"] = false;
    expect(validateDataset(data).errors).toEqual([]);
    offer["is_arranged"] = "yes";
    expect(validateDataset(data).ok).toBe(false);
  });
});
