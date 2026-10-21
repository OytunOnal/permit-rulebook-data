import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reckonAskingRoutes } from "../src/index.js";
import type { Dataset, OpenRoute } from "../src/index.js";

/**
 * The routes a question is asked for, named by the engine from the same walk
 * that decides to ask it — so the asked-for line can never name a route that
 * does not read the answer (#133, decision 6).
 */
const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

const ids = (routes: OpenRoute[]): string[] => routes.map((r) => r.route.id);

describe("the routes a question is asked for", () => {
  it("funds on a Germany-offer profile: asked for the Opportunity Card alone, among more open routes", () => {
    const offer = { destination: "de", citizenship: "IN", situation: "offer" };
    const { asked_for, open } = reckonAskingRoutes(dataset, offer, "funds_eur_month");
    expect(ids(asked_for)).toEqual(["de-chancenkarte"]);
    expect(asked_for[0]!.country).toBe("DE");
    expect(open.length).toBeGreaterThan(1);
  });
});
