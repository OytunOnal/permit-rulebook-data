import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, forEachCriterion, referencedFields, routeStatements } from "../src/engine.js";
import type { Dataset, Profile, Route } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const routeOf = (id: string): Route =>
  dataset.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;

function fieldsOf(route: Route): string[] {
  const out = new Set<string>();
  forEachCriterion(route.criteria, (c) => { for (const f of referencedFields(c)) out.add(f); });
  return [...out];
}

const statusOf = (profile: Profile, id: string) =>
  evaluate(dataset, profile).find((r) => r.route.id === id)!.status;

/**
 * § 20a AufenthG (buzer.de mirror, read by a person 2026-09-07) sets four
 * conditions — skilled worker or points, secured living costs, and a residence
 * title for anyone already in Germany. None of them is "you have no job
 * offer". The card's PURPOSE is job-seeking; that is not an eligibility
 * condition, and modelling it as one hid the card from every offer-holder —
 * the same invented criterion removed from the orientation year the same day.
 */
describe("the Opportunity Card asks about the applicant, not about their luck so far", () => {
  const seeker: Profile = {
    destination: "de", citizenship: "TR", qualification: "degree",
    german: "a1", funds_eur_month: "band_1", recognition_de: "recognized",
  };

  it("is reachable with a job offer", () => {
    expect(statusOf({ ...seeker, situation: "offer" }, "de-chancenkarte")).toBe("met");
  });

  it("is reachable with a transfer or a hosting agreement too", () => {
    expect(statusOf({ ...seeker, situation: "ict" }, "de-chancenkarte")).toBe("met");
    expect(statusOf({ ...seeker, situation: "research" }, "de-chancenkarte")).toBe("met");
  });

  it("still reaches the person it was written for", () => {
    expect(statusOf({ ...seeker, situation: "none" }, "de-chancenkarte")).toBe("met");
  });

  it("no criterion of the card reads what the person has arranged", () => {
    expect(fieldsOf(routeOf("de-chancenkarte"))).not.toContain("situation");
  });

  it("the guidance survives as words a reader can weigh, not as a rule that fails them", () => {
    const summary = routeOf("de-chancenkarte").summary!;
    expect(summary).toMatch(/offer/i);
    expect(summary).toMatch(/compare|fit you directly/i);
  });

  it("the 20-hour limit is a caveat with its quote — what the card ALLOWS, never a condition of getting it", () => {
    const statement = routeStatements(routeOf("de-chancenkarte")).find((s) => /20 hours/.test(s.text))!;
    expect(statement, "the card says nothing about the 20-hour limit").toBeDefined();
    expect(statement.kind).toBe("caveat");
    expect(statement.source!.quote).toContain("20 Stunden je Woche");
    expect(statement.source!.source_url).toBe("https://www.buzer.de/20a_AufenthG.htm");
    expect(statement.source!.retrieved_at).toBe("2026-09-07");
    // It was removed once for reading as a requirement (human catch
    // 2026-09-04); nothing may put it back under that heading.
    const required = [
      ...(routeOf("de-chancenkarte").preconditions ?? []),
      ...routeStatements(routeOf("de-chancenkarte")).filter((s) => s.kind === "precondition").map((s) => s.text),
    ];
    expect(required).toEqual([]);
  });
});
