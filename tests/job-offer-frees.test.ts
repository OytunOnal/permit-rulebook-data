import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateDataset } from "../src/validate.js";
import { evaluate, fieldOptions, routesAJobOfferFrees, SITUATION_FIELD } from "../src/index.js";
import type { Dataset, Profile } from "../src/index.js";

/** A fresh parse of the shipped dataset, for a case to break or reorder. */
const shippedDatasetCopy = () => JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));
const ds = shippedDatasetCopy() as Dataset;

/** The explorer persona of the site's s23: all four countries, no offer, and
 * none of the questions only an offer would raise answered. */
const PRIYA: Profile = {
  destination: "all", citizenship: "IN", situation: "none", qualification: "degree", recognition_de: "unknown",
  occupation_shortage: "unknown", experience_5y: "2plus", experience_7y: "3to5", german: "none", english: "c1", nl_recent_grad: "no",
  top200_grad: "unknown", funds_eur_month: "band_1", age_band: "u30", de_stay6m: "no", partner_ck: "no",
};

describe("what a job offer frees for a reader who has none", () => {
  const freedForPriya = () => routesAJobOfferFrees(ds, PRIYA);
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
    const jobOfferAnswer = fieldOptions(ds, SITUATION_FIELD).find((o) => !o.is_arranged && !o.is_fallback && !o.is_unknown)!;
    let failedToday = 0;
    for (const place of fieldOptions(ds, "situation_country")) {
      const withAJobOffer: Profile = { ...PRIYA, [SITUATION_FIELD]: jobOfferAnswer.value, situation_country: place.value };
      for (const r of evaluate(ds, withAJobOffer)) {
        if (!baseline.get(r.route.id)!.hard_fail) continue;
        failedToday++;
        expect(["met", "near"], `${r.route.id}, with an offer in ${place.value}`).not.toContain(r.status);
      }
    }
    expect(failedToday, "precondition: the reader fails some route today").toBeGreaterThan(0);
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

  it("an offer-holder, and a reader whose situation is a transfer, get nothing", () => {
    const situations = fieldOptions(ds, SITUATION_FIELD);
    const jobOfferAnswer = situations.find((o) => !o.is_arranged && !o.is_fallback && !o.is_unknown)!;
    const transfer = situations.find((o) => o.value === "ict")!;
    expect(transfer.is_arranged, "precondition: a transfer is an arranged answer").toBe(true);
    expect(routesAJobOfferFrees(ds, PRIYA).length, "precondition: the explorer is freed something").toBeGreaterThan(0);
    for (const held of [jobOfferAnswer, transfer])
      expect(routesAJobOfferFrees(ds, { ...PRIYA, [SITUATION_FIELD]: held.value }), held.value).toEqual([]);
  });
});

describe("the job offer is read from the dataset's marks", () => {
  /** What an offer frees, as country and route ids — comparable across datasets. */
  const freedIdsOf = (dataset: Dataset) =>
    routesAJobOfferFrees(dataset, PRIYA).map((f) => [f.country, f.routes.map((r) => r.route.id)]);

  it("a dataset with the situation's answers reordered still finds the job offer", () => {
    const reordered = shippedDatasetCopy();
    situationOptionsOf(reordered).reverse();
    expect(situationOptionsOf(reordered)[0]!["is_fallback"], "precondition: the order moved").toBe(true);
    expect(freedIdsOf(reordered)).toEqual(freedIdsOf(ds));
  });

  it("a dataset whose situation question has no answer a reader can go and get is refused", () => {
    const datasetWithNoJobOffer = shippedDatasetCopy();
    for (const o of situationOptionsOf(datasetWithNoJobOffer)) if (!o["is_fallback"]) o["is_arranged"] = true;
    expect(() => routesAJobOfferFrees(datasetWithNoJobOffer, PRIYA)).toThrow(/exactly one job offer/);
  });
});

/** The situation question's options in a copied dataset, to break or reorder in a test. */
const situationOptionsOf = (data: { fields: { id: string; options?: Record<string, unknown>[] }[] }) =>
  data.fields.find((f) => f.id === "situation")!.options!;

describe("an arranged answer is a mark the schema declares", () => {
  it("a boolean is_arranged is accepted and a non-boolean one is refused", () => {
    const data = shippedDatasetCopy();
    const jobOfferAnswer = situationOptionsOf(data).find((o) => !o["is_arranged"] && !o["is_fallback"])!;
    jobOfferAnswer["is_arranged"] = false;
    expect(validateDataset(data).errors).toEqual([]);
    jobOfferAnswer["is_arranged"] = "yes";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("an arranged answer on a question that is not a path is refused", () => {
    const data = shippedDatasetCopy();
    expect(validateDataset(data).errors, "precondition: the shipped dataset is valid").toEqual([]);
    const notAPath = (data.fields as { id: string; kind?: string; options?: Record<string, unknown>[] }[])
      .find((f) => f.kind !== "path" && f.options?.length)!;
    notAPath.options![0]!["is_arranged"] = true;
    const result = validateDataset(data);
    expect(result.ok, `${notAPath.id} is not a path question`).toBe(false);
    expect(result.errors.map((e) => e.keyword)).toContain("arrangedOnAPathOnly");
  });
});
