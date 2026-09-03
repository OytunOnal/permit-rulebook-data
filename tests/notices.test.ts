import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { datasetMeta, notices } from "../src/engine.js";
import { checkCoverage, datasetSourceUrls, type Watchlist } from "../src/watch/core.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const shippedWatchlist = JSON.parse(readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;

const euPassport: Profile = { destination: "de", citizenship: "eu_eea_ch", situation: "offer" };

describe("notices — the true answer when no route applies (critique #1)", () => {
  it("an EU/EEA/Swiss passport matches the free-movement notice, quoted and dated", () => {
    const matched = notices(dataset, euPassport);
    expect(matched.map((n) => n.id)).toEqual(["eu-free-movement"]);
    expect(matched[0].kind).toBe("no-permit-needed");
    expect(matched[0].source.quote).toContain("you generally don't need a work permit");
    expect(matched[0].source.retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a third-country passport matches nothing — the routes are for them", () => {
    expect(notices(dataset, { ...euPassport, citizenship: "third_country" })).toEqual([]);
  });

  it("an unanswered citizenship matches nothing (a notice is never a guess)", () => {
    expect(notices(dataset, {})).toEqual([]);
    expect(notices(dataset, { destination: "de" })).toEqual([]);
  });
});

describe("a notice is data like any other value: sourced and watched", () => {
  it("its source counts as a dataset source", () => {
    const url = dataset.notices![0].source.source_url;
    expect([...datasetSourceUrls(dataset)]).toContain(url);
  });

  it("the shipped watchlist covers it, both ways", () => {
    const result = checkCoverage(dataset, shippedWatchlist);
    expect(result.missing_from_watchlist).toEqual([]);
    expect(result.orphan_watch_entries).toEqual([]);
  });

  it("meta's newest read date considers notice sources too", () => {
    expect(datasetMeta(dataset).newest_retrieved_at).toBe(dataset.notices![0].source.retrieved_at);
  });
});
