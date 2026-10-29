import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, reckonAskingRoutes, remainingQuestions } from "../src/index.js";
import type { Dataset, OpenRoute } from "../src/index.js";
import { lcg, randomProfile } from "./random-profile.js";

/**
 * The routes a question is asked for, named by the engine from the same walk
 * that decides to ask it — so the asked-for line can never name a route that
 * does not read the answer (#133, decision 6).
 */
const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const ids = (routes: OpenRoute[]): string[] => routes.map((r) => r.route.id);

describe("the routes a question is asked for", () => {
  it("funds on a Germany-offer profile: asked for the Opportunity Card alone, among more open routes", () => {
    const readerWithJobOffer = { destination: "de", citizenship: "IN", situation: "offer" };
    const { asked_for, open } = reckonAskingRoutes(dataset, readerWithJobOffer, "funds_eur_month");
    expect(ids(asked_for)).toEqual(["de-chancenkarte"]);
    expect(asked_for[0]!.country).toBe("DE");
    expect(open.length).toBeGreaterThan(1);
  });

  it("the passport on an empty profile: asked for every open route", () => {
    const { asked_for, open } = reckonAskingRoutes(dataset, {}, "citizenship");
    expect(open.length, "an empty profile leaves no route open").toBeGreaterThan(0);
    expect(ids(asked_for)).toEqual(ids(open));
  });

  it("a route with a hard fail is never one a question is asked for (300 random profiles)", () => {
    const rand = lcg(135);
    let hardFailsSeen = 0;
    for (let i = 0; i < 300; i++) {
      const profile = randomProfile(dataset, rand, rand() < 0.5 ? 0.3 : 0.7);
      const hardFailed = new Set(evaluate(dataset, profile).filter((r) => r.hard_fail).map((r) => r.route.id));
      hardFailsSeen += hardFailed.size;
      for (const def of dataset.fields) {
        const { asked_for, open } = reckonAskingRoutes(dataset, profile, def.id);
        const where = `${def.id} @ ${JSON.stringify(profile)}`;
        expect(ids(asked_for).filter((id) => hardFailed.has(id)), where).toEqual([]);
        expect(ids(open).filter((id) => hardFailed.has(id)), where).toEqual([]);
      }
    }
    expect(hardFailsSeen, "no generated profile hard-failed a route").toBeGreaterThan(0);
  });

  it("names a route exactly when the asking rule would ask the question (300 random profiles)", { timeout: 120_000 }, () => {
    const rand = lcg(1335);
    let askedSeen = 0;
    let unaskedUnansweredSeen = 0;
    for (let i = 0; i < 300; i++) {
      const profile = randomProfile(dataset, rand, rand() < 0.5 ? 0.3 : 0.7);
      const asked = new Set(remainingQuestions(dataset, profile).map((q) => q.field));
      askedSeen += asked.size;
      for (const def of dataset.fields) {
        if (!asked.has(def.id) && profile[def.id] === undefined) unaskedUnansweredSeen++;
        const named = reckonAskingRoutes(dataset, profile, def.id).asked_for.length;
        expect(named > 0, `${def.id} @ ${JSON.stringify(profile)}`).toBe(asked.has(def.id));
      }
    }
    expect(askedSeen, "the asking rule asked nothing on any generated profile").toBeGreaterThan(0);
    expect(unaskedUnansweredSeen, "no generated profile left an unanswered question unasked").toBeGreaterThan(0);
  });
});
