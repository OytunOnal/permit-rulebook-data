import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateDataset } from "../src/validate.js";
import { evaluate, fieldOptions, routesAnOfferFrees, SITUATION_FIELD } from "../src/index.js";
import type { Dataset, Profile } from "../src/index.js";

const load = () => JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));
const ds = load() as Dataset;

/** The explorer persona of the site's s23: all four countries, no offer, and
 * none of the questions only an offer would raise answered. */const PRIYA: Profile = {
  destination: "all", citizenship: "IN", situation: "none", qualification: "degree", recognition_de: "unknown",
  occupation_shortage: "unknown", experience_5y: "2plus", experience_7y: "3to5", german: "none", english: "c1", nl_recent_grad: "no",
  top200_grad: "unknown", funds_eur_month: "band_1", age_band: "u30", de_stay6m: "no", partner_ck: "no",
};

describe("what a job offer frees for a reader who has none", () => {
  const freedForPriya = () => routesAnOfferFrees(ds, PRIYA);
  const baseline = new Map(evaluate(ds, PRIYA).map((r) => [r.route.id, r]));

  it("an offer in each of the four countries frees a hard-failed route there", () => {
    expect(freedForPriya().map((f) => f.country).sort()).toEqual(ds.countries.map((c) => c.code).sort());
    for (const { country, routes } of freedForPriya()) {
      expect(routes.length, country).toBeGreaterThan(0);
      for (const r of routes) {
        expect(r.country, r.route.id).toBe(country);
        expect(baseline.get(r.route.id)!.hard_fail, `${r.route.id} was not hard-failed`).toBe(true);
      }
    }
  });

  it("a freed route is only checked under the offer: none is met or within reach", () => {
    for (const { routes } of freedForPriya())
      for (const r of routes) {
        expect(r.hard_fail, r.route.id).toBe(false);
        expect(r.status, r.route.id).toBe("hold");
      }
  });

  it("each freed route names a question the reader has not settled, once each, in the dataset's order", () => {
    const order = ds.fields.map((f) => f.id);
    const isSettled = (f: string) =>
      PRIYA[f] !== undefined && !fieldOptions(ds, f).find((o) => o.value === PRIYA[f])?.is_unknown;
    for (const { country, routes, fieldsLeftOpen } of freedForPriya()) {
      for (const r of routes) expect(r.unknown_fields.some((f) => fieldsLeftOpen.includes(f)), r.route.id).toBe(true);
      for (const f of fieldsLeftOpen) expect(isSettled(f), `${country} names ${f}, which the reader settled`).toBe(false);
      expect(new Set(fieldsLeftOpen).size, country).toBe(fieldsLeftOpen.length);
      expect([...fieldsLeftOpen].sort((a, b) => order.indexOf(a) - order.indexOf(b)), country).toEqual(fieldsLeftOpen);
    }
  });
});

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
