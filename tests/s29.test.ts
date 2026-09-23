import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import dataset from "../data/dataset.json" with { type: "json" };
import { checkCoverage, checkQuotes, type Watchlist } from "../src/watch/core.js";
import type { WatchState } from "../src/watch/state.js";
import { datasetMeta, noticeSources } from "../src/engine.js";
import type { Dataset, Route } from "../src/types.js";

const ds = dataset as unknown as Dataset;
const readJson = (name: string) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8").replace(/^﻿/, ""));
const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const state = readJson("../watch/state.json") as WatchState;

/**
 * s29 — three data corrections (v1.2: data #13, data #15, the s28 light
 * critique's third finding).
 *
 * Every route's "Official page" went to an authority except the Opportunity
 * Card's, which went to a guide site; the free-movement notice named five
 * groups and quoted a sentence covering one; the Algerian notice's door was a
 * statement where s28 had made every field's door an action. Data only — the
 * site changes by rebuilding against the pin.
 */

const routeOf = (id: string): Route => ds.countries.flatMap((c) => c.routes).find((r) => r.id === id)!;
const noticeOf = (id: string) => ds.notices!.find((n) => n.id === id)!;
const entryOf = (id: string) => watchlist.entries.find((e) => e.id === id);
const entryFor = (url: string) => watchlist.entries.find((e) => e.url === url);

const BMI_CHANCENKARTE = "https://www.bmi.bund.de/SharedDocs/kurzmeldungen/EN/2024/05/chancenkarte.html";
const IND_EU_EEA_CH =
  "https://ind.nl/en/residence-permits/eu-eea-or-swiss-citizens/staying-in-the-netherlands-as-an-eu-eea-or-swiss-citizen";
const YOUR_EUROPE_WORK_PERMITS = "https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm";

describe("s29 #13 — the Opportunity Card's official page is an authority's", () => {
  /**
   * The issue's decision, as a declared set: hosts that explain the law and
   * are not the authority that makes it. A route's "Official page ↗" may not
   * point at one. handbookgermany.de is a federally funded guide; the card
   * linked it because the ministry's own page was not found on 2026-09-13.
   * Grow the list with the issue that names the next one.
   */
  const NON_AUTHORITIES = ["handbookgermany.de"];

  it("points at the Federal Ministry of the Interior's own English page", () => {
    expect(routeOf("de-chancenkarte").info_url).toBe(BMI_CHANCENKARTE);
  });

  it("no route's info_url host is on the declared non-authority list", () => {
    for (const route of ds.countries.flatMap((c) => c.routes)) {
      const host = new URL(route.info_url).hostname;
      expect(
        NON_AUTHORITIES.some((h) => host === h || host.endsWith(`.${h}`)),
        `${route.id}: ${route.info_url} is on a non-authority host`,
      ).toBe(false);
    }
  });

  it("the page is watched, so the day it disappears the watch says so", () => {
    const entry = entryFor(BMI_CHANCENKARTE);
    expect(entry, "no watch entry for the BMI page").toBeDefined();
    // It backs no quote — a route's info page is where the reader goes, not
    // where a value was read — so it is a sentinel, or coverage calls it an
    // orphan.
    expect(entry!.kind).toBe("sentinel");
  });

  it("still names the sentinel sentence a reader is sent to find", () => {
    // RETIRED IN PART BY s34, 2026-09-23. This case read "is on the human
    // tier, with the sentinel sentence a person confirms", and asserted the
    // human strategy, the quarterly age, the 2026-09-17 read date and the
    // absence of a snapshot. The cookie round-trip that put the page on that
    // tier is one a browser makes without being asked, so the entry is a
    // browser entry now and `tests/s34.test.ts` holds its shape. What does not
    // change is the sentence this sentinel exists to watch for, so that half
    // of the promise stays here.
    const entry = entryFor(BMI_CHANCENKARTE)!;
    expect(entry.note).toContain(
      "The opportunity card is a new type of residence permit for those coming to Germany to look for work.",
    );
  });

  it("records where the route's page pointed before, and the day it moved", () => {
    // A route's info_url is a bare string in the schema — no history slot, no
    // reason enum — so the append-only trail for the move is the entry's own
    // history, the one dated log this repository keeps about a URL.
    const entry = entryFor(BMI_CHANCENKARTE)!;
    const moved = entry.history?.find((h) => h.note.includes("handbookgermany.de/en/opportunity-card"));
    expect(moved, "no history line naming the old URL").toBeDefined();
    expect(moved!.changed_at).toBe("2026-09-17");
  });

  it("the checklist says which page to open and which sentence to find, so the quarterly reminder has a task", () => {
    // CONTRIBUTING: a human-tier entry is written down in verify-s5e.md. This
    // one carries no quote — the sentence is the sentinel, not a value.
    // The file wraps its prose; the sentence is read the way s14 reads it.
    const checklist = readFileSync(new URL("../data/verify-s5e.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(checklist).toContain(BMI_CHANCENKARTE);
    expect(checklist).toContain(
      "The opportunity card is a new type of residence permit for those coming to Germany to look for work.",
    );
  });
});

describe("s29 #15 — the free-movement notice carries the sentences that cover its groups", () => {
  const notice = () => noticeOf("eu-free-movement");

  it("the body names the five groups and did not change", () => {
    expect(notice().body).toBe(
      "Citizens of the EU, of Iceland, Liechtenstein and Norway, and of Switzerland, can live and work in Germany, France, Spain and the Netherlands under free movement — the routes on this site are for other passports. Check registration rules after arrival (e.g. Anmeldung in Germany).",
    );
  });

  it("leads with the EU sentence it always had, then the EEA sentence, then the Swiss one", () => {
    const sources = noticeSources(notice());
    expect(sources.map((s) => s.source_url)).toEqual([YOUR_EUROPE_WORK_PERMITS, IND_EU_EEA_CH, YOUR_EUROPE_WORK_PERMITS]);
    expect(sources[0].quote).toBe("As an EU national you generally don't need a work permit to work anywhere in the EU.");
    expect(sources[0].retrieved_at).toBe("2026-09-03");
  });

  it("the EEA sentence is the IND's, verbatim, dated the day it was read, with the agreement it rests on", () => {
    const [, eea] = noticeSources(notice());
    expect(eea).toEqual({
      source_url: IND_EU_EEA_CH,
      quote: "Nationals of the member states of the European Economic Area (EEA) and Switzerland have the same rights as citizens of the Union.",
      retrieved_at: "2026-09-17",
      legal_basis: "EEA Agreement art. 28 — IND",
      history: [],
    });
  });

  it("the Swiss sentence is Your Europe's, verbatim, dated the day it was read, with the agreement it rests on", () => {
    const [, , swiss] = noticeSources(notice());
    expect(swiss).toEqual({
      source_url: YOUR_EUROPE_WORK_PERMITS,
      quote: "Under the EU-Switzerland agreement on the free movement of persons, Swiss nationals are free to live and work in the EU.",
      retrieved_at: "2026-09-17",
      legal_basis: "EU–Switzerland Agreement on the Free Movement of Persons (1999) — Your Europe",
      history: [],
    });
  });

  it("every group the body names is inside one of the quotes", () => {
    const quotes = noticeSources(notice()).map((s) => s.quote).join(" ");
    expect(quotes).toContain("As an EU national");
    expect(quotes).toContain("European Economic Area (EEA)");
    expect(quotes).toContain("Swiss nationals");
  });

  it("the IND page is watched on the machine, sliced to the section the sentence is in", () => {
    // Measured 2026-09-17 with this watch's client: HTTP 200, 51,875 bytes,
    // the sentence in the visible prose — the general EU/EEA/CH page is not
    // one of the five form-walled route pages.
    const entry = entryFor(IND_EU_EEA_CH);
    expect(entry, "no watch entry for the IND page").toBeDefined();
    expect(entry!.strategy).toBe("html");
    expect(entry!.kind).toBe("value-source");
    // ind.nl has answered this host with an app shell; a slice turns that
    // into "unreachable" instead of "changed" (watch.test.ts holds every
    // ind.nl html entry to a marker — this is the tenth).
    expect(entry!.slice).toBeDefined();
    const snapshot = state.entries[entry!.id];
    expect(snapshot?.text, "the entry was added without its baseline — run npm run watch:sources -- --only=<id> --commit").toBeDefined();
    expect(snapshot!.text).toContain(
      "Nationals of the member states of the European Economic Area (EEA) and Switzerland have the same rights as citizens of the Union.",
    );
  });

  it("the Your Europe entry already watched the page, and its slice holds the Swiss sentence", () => {
    const entry = entryOf("eu-your-europe-work-permits")!;
    expect(entry.url).toBe(YOUR_EUROPE_WORK_PERMITS);
    expect(state.entries[entry.id].text).toContain(
      "Under the EU-Switzerland agreement on the free movement of persons, Swiss nationals are free to live and work in the EU.",
    );
  });

  it("both new quotes verify against their snapshots: not missing, not on the human tier", () => {
    const result = checkQuotes(ds, watchlist, state);
    expect(result.missing).toEqual([]);
    expect(result.unverifiable.filter((u) => u.where === "notice:eu-free-movement")).toEqual([]);
    expect(checkCoverage(ds, watchlist).ok).toBe(true);
  });
});

describe("s29 — the Algerian notice's door is an action", () => {
  it("reads the sentence the scenario decided", () => {
    expect(noticeOf("fr-dz-talent-open-question").learn).toEqual({
      label: "Read the page for Algerian nationals (certificat de résidence d'un an)",
      url: "https://www.service-public.gouv.fr/particuliers/vosdroits/F2215",
    });
  });
});

describe("s29 — the dataset says so in its version, and the schema did not move", () => {
  it("the schema did not move: three data changes on the day, none of them a shape", () => {
    // The version is a date and already read the day (s23 pins it); the
    // convention keeps one stamp for every change of the same day. 0.8.1
    // when this was written; 0.8.2 since s32, for a reason of its own.
    expect(datasetMeta(ds).schema_version).toBe("0.8.2");
  });

  it("two sentences were read at their sources today", () => {
    expect(datasetMeta(ds).newest_retrieved_at).toBe("2026-09-17");
  });
});
