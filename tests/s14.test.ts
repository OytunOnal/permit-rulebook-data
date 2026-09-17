import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { checkCoverage, checkQuotes, datasetQuotes, runWatch, STRATEGIES, type Fetcher, type Watchlist } from "../src/watch/core.js";
import { unreadNeverRead, unreadSentence, unreadSources, type WatchState } from "../src/watch/state.js";
import type { Dataset } from "../src/types.js";

/**
 * s14 — the IND's requirements moved behind a form.
 *
 * On 2026-09-16 the watch found the highly-skilled-migrant page changed and
 * four sibling IND pages unreachable. Read the same day: every one of the five
 * route pages is a Drupal form now — "Your situation — we will first ask you a
 * few questions" — and the requirements are rendered only after a nationality
 * and a situation are chosen. The result has no address of its own (the human:
 * "url sabit"), so there is nothing the watch could fetch. The five entries go
 * to the human tier, their stale snapshots leave the state, and the quote gate
 * says "unverifiable" where it used to say "verified" against a page that no
 * longer exists in that form.
 *
 * These cases are the slice's own promises. The site's freshness sentence is
 * s11's, and the case at the end confirms it is not disturbed: a human-tier
 * entry was never a machine read, so it is not "unread".
 */

const readJson = (name: string) =>
  JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8").replace(/^﻿/, ""));
const dataset = readJson("../data/dataset.json") as Dataset;
const watchlist = readJson("../watch/watchlist.json") as Watchlist;
const state = readJson("../watch/state.json") as WatchState;

/** The five route pages that went behind the form, with the URL each backs. */
const FORM_GATED: Record<string, string> = {
  "nl-ind-highly-skilled-migrant": "https://ind.nl/en/residence-permits/work/highly-skilled-migrant",
  "nl-ind-orientation-year": "https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year",
  "nl-ind-blue-card": "https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit",
  "nl-ind-ict": "https://ind.nl/en/residence-permits/work/intra-corporate-transferee-residence-permit-directive-201466eu",
  "nl-ind-researcher": "https://ind.nl/en/residence-permits/work/residence-permit-researcher-directive-eu-2016801",
};
const FORM_GATED_URLS = new Set(Object.values(FORM_GATED));

/** The two IND pages the scenario leaves alone: one cited by nothing, one still plain text. */
const UNTOUCHED = ["nl-ind-work-index", "nl-ind-required-amounts"];

/** The two entries that opened the bot-gated human tier on 2026-09-10 — the template. */
const BOT_GATED = ["legifrance-ce-algerian-titles", "eur-lex-blue-card-directive"];

const entryOf = (id: string) => watchlist.entries.find((e) => e.id === id)!;

describe("s14 — the five IND route-page entries are human-tier", () => {
  it("each takes the human strategy, a quarterly age and a read date, and loses its slice", () => {
    for (const [id, url] of Object.entries(FORM_GATED)) {
      const entry = entryOf(id);
      expect(entry, id).toBeDefined();
      expect(entry.url, id).toBe(url);
      expect(entry.strategy, id).toBe("human");
      expect(entry.kind, id).toBe("value-source");
      expect(entry.max_age_days, id).toBe(90);
      // The day a person read the page through the form — never earlier than
      // the day the form was found, which is the day this slice opened.
      expect(entry.last_verified, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.last_verified! >= "2026-09-16", `${id}: read before the form was found`).toBe(true);
      // A human entry watches no region of a page: there is no page to slice.
      expect(entry.slice, `${id}: a human-tier entry carries a slice`).toBeUndefined();
    }
  });

  it("each note says what it backs, why a person, the measurement, the road back and the re-read", () => {
    for (const id of Object.keys(FORM_GATED)) {
      const note = entryOf(id).note ?? "";
      expect(note, `${id}: the note does not name the form`).toMatch(/Your situation/);
      expect(note, `${id}: the note does not say the result has no address`).toMatch(/no address/i);
      expect(note, `${id}: the note does not carry the measurement`).toMatch(/2026-09-16/);
      expect(note, `${id}: the note does not carry the ~700-character shell`).toMatch(/700/);
      expect(note, `${id}: the note does not name the road back (data #17)`).toMatch(/#17/);
      expect(note, `${id}: the note does not say it is re-read quarterly`).toMatch(/quarterly/i);
      expect(note, `${id}: the note does not say what the entry backs`).toMatch(/Backs /);
    }
  });

  it("the two bot-gated entries of 2026-09-10 are the template and are unchanged", () => {
    for (const id of BOT_GATED) {
      const entry = entryOf(id);
      expect(entry.strategy, id).toBe("human");
      expect(entry.max_age_days, id).toBe(90);
      expect(entry.last_verified, id).toBe("2026-09-10");
    }
  });

  it("leaves the salary-amounts page and the work index on the machine, sliced", () => {
    for (const id of UNTOUCHED) {
      const entry = entryOf(id);
      expect(entry.strategy, id).toBe("html");
      expect(entry.slice, id).toBeDefined();
      expect(state.entries[id]?.text, `${id}: the machine-read page lost its snapshot`).toBeDefined();
    }
  });

  it("the HSM entry keeps the record of the marker a person moved on 2026-09-08", () => {
    // The slice is gone; the reason it was widened is not. A reader of the
    // `changed` flag of 2026-09-08 still needs to find here that a person
    // moved the marker, and a reader of the flag of 2026-09-16 that the page
    // itself went behind a form.
    const history = entryOf("nl-ind-highly-skilled-migrant").history ?? [];
    expect(history.find((h) => h.changed_at === "2026-09-08")).toBeDefined();
    expect(history.find((h) => h.changed_at === "2026-09-16")?.note).toMatch(/form/i);
  });
});

describe("s14 — the state carries no stale IND snapshot", () => {
  it("represents the five the way it represents every human-tier entry: absent", () => {
    // The two bot-gated entries have never had a snapshot; the state has one
    // shape for "read by a person", and it is the absence of a machine reading.
    for (const id of BOT_GATED) expect(state.entries[id], id).toBeUndefined();
    for (const id of Object.keys(FORM_GATED))
      expect(state.entries[id], `${id}: a human-tier entry with a machine snapshot`).toBeUndefined();
  });

  it("names none of the five as unread — a page a person reads was never a machine read", () => {
    for (const u of state.unread ?? [])
      expect(FORM_GATED[u.id], `${u.id} is human-tier and listed as unread`).toBeUndefined();
  });
});

describe("s14 — the quote gate reports the IND sentences as unverifiable, not verified and not missing", () => {
  const result = checkQuotes(dataset, watchlist, state);
  const humanReason = STRATEGIES.human.no_text_snapshot;

  it("is green: nothing is missing, and coverage holds both ways", () => {
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(checkCoverage(dataset, watchlist).ok).toBe(true);
  });

  it("the unverifiable set is exactly the form-gated quotes plus the two bot-gated ones, all with the human reason", () => {
    const formGated = datasetQuotes(dataset).filter((q) => FORM_GATED_URLS.has(q.source_url));
    // 12 + 8 + 7 + 6 + 5 — counted from the dataset, not from the scenario,
    // which estimated 37. HSM carries six sentences on each of two routes.
    expect(formGated.length).toBe(38);
    const byPage = new Map<string, number>();
    for (const q of formGated) byPage.set(q.source_url, (byPage.get(q.source_url) ?? 0) + 1);
    expect(byPage.get(FORM_GATED["nl-ind-highly-skilled-migrant"]!)).toBe(12);
    expect(byPage.get(FORM_GATED["nl-ind-orientation-year"]!)).toBe(8);
    expect(byPage.get(FORM_GATED["nl-ind-blue-card"]!)).toBe(7);
    expect(byPage.get(FORM_GATED["nl-ind-ict"]!)).toBe(6);
    expect(byPage.get(FORM_GATED["nl-ind-researcher"]!)).toBe(5);

    const key = (q: { where: string; source_url: string; quote: string }) => `${q.where} ${q.source_url} ${q.quote}`;
    const human = result.unverifiable.filter((u) => u.reason === humanReason);
    expect(human.length).toBe(result.unverifiable.length);
    const expected = new Set(formGated.map(key));
    for (const u of human) {
      if (u.where === "notice:fr-dz-talent-open-question") continue;
      expect(expected.has(key(u)), `${u.where}: unverifiable for a reason other than the IND form`).toBe(true);
      expected.delete(key(u));
    }
    expect([...expected], "form-gated quotes the gate did not report").toEqual([]);
    // The two of 2026-09-10, still there.
    expect(human.filter((u) => u.where === "notice:fr-dz-talent-open-question").length).toBe(2);
    expect(result.unverifiable.length).toBe(40);
  });

  it("verified drops by exactly what the stale snapshots had been vouching for", () => {
    // 171 on 2026-09-16 with the twelve HSM quotes missing; the other
    // twenty-six IND sentences were "verified" against snapshots of pages that
    // are a form now. 171 − 26 = 145. The scenario's 171 is the number from
    // before the move, when the stale pages still counted. 154 since s19: the
    // nine chercheur sentences on France's researcher card, verified through
    // the talent fiche's widened slice. 156 since s29: the free-movement
    // notice's EEA sentence (the IND's general page, on the machine) and its
    // Swiss sentence (inside the Your Europe slice already held).
    expect(result.verified).toBe(145 + 9 + 2);
  });
});

describe("s14 — the checklist gains the five", () => {
  const path = new URL("../data/verify-s5e.md", import.meta.url);
  const checklist = existsSync(path) ? readFileSync(path, "utf8").replace(/\s+/g, " ") : "";

  it("opens a section for the form-gated tier, one subsection per page, with the way in", () => {
    expect(checklist).toContain("3. Quotes that need a person — form-gated web tier (5 pages, 38 quotes");
    expect(checklist).toContain("opened 2026-09-16");
    for (const url of FORM_GATED_URLS) expect(checklist, url).toContain(url);
    // How to reach the requirements: the form asks for a nationality first.
    expect(checklist).toMatch(/What is your nationality\?/);
  });

  it("writes every form-gated sentence down, verbatim, with the route and the field it backs", () => {
    for (const q of datasetQuotes(dataset).filter((q) => FORM_GATED_URLS.has(q.source_url))) {
      expect(checklist, `${q.where}: not named`).toContain(q.where);
      expect(checklist, `${q.where}: the sentence itself is not written down`).toContain(q.quote.replace(/\s+/g, " "));
    }
  });
});

describe("s14 — the watch runs green with the five on the human arm", () => {
  it("fetches nothing for them, reports ok, and leaves no unread IND entry", async () => {
    const neverFetch: Fetcher = async (url) => { throw new Error(`must not fetch a human-tier page: ${url}`); };
    const five: Watchlist = { entries: Object.keys(FORM_GATED).map(entryOf) };
    const { reports, nextState } = await runWatch(five, state, neverFetch, "2026-09-17");
    expect(reports.map((r) => r.outcome)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(nextState.unread).toEqual([]);
    for (const id of Object.keys(FORM_GATED)) expect(nextState.entries[id], id).toBeUndefined();
  });

  it("a quarter later the reminder fires, which is the re-read the notes promise", async () => {
    const five: Watchlist = { entries: Object.keys(FORM_GATED).map(entryOf) };
    const { reports } = await runWatch(five, state, async () => { throw new Error("no"); }, "2027-01-15");
    expect(reports.every((r) => r.outcome === "reminder-due")).toBe(true);
  });
});

describe("s14 — s11's freshness sentence is not disturbed (point 7)", () => {
  it("a human-tier entry never reaches the exception clause, even if a stale list names it", () => {
    // The state a run of 2026-09-16 wrote, read after the five have moved: the
    // list still names four IND pages the run could not read, and their
    // snapshots are gone. The clause names only the source that has a reading
    // to name a date from; the four have none and are not "unread".
    const stale: WatchState = {
      entries: { "bamf-hochschulabsolvent": { hash: "h", retrieved_at: "2026-09-07", history: [] } },
      last_run: "2026-09-16",
      unread: [
        { id: "bamf-hochschulabsolvent", url: "https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Arbeit/Hochschulabsolvent/hochschulabsolvent-node.html" },
        ...["nl-ind-orientation-year", "nl-ind-blue-card", "nl-ind-ict", "nl-ind-researcher"]
          .map((id) => ({ id, url: FORM_GATED[id]! })),
      ],
    };
    const sources = unreadSources(dataset, stale);
    expect(sources.map((s) => s.id)).toEqual(["bamf-hochschulabsolvent"]);
    expect(unreadSentence(sources))
      .toBe("A German source did not answer on the last run; the values it backs were read on 2026-09-07.");
    // FINDING for the session, not a fix here: the state travels without the
    // watchlist, so the derivation cannot tell "human-tier" from "never
    // fetched" — a stale list that names a human entry counts it under
    // `never_read`. The shipped state does not carry such a list (see above),
    // and the next run writes the list afresh without them.
    expect(unreadNeverRead(dataset, stale).map((e) => e.id).sort())
      .toEqual(["nl-ind-blue-card", "nl-ind-ict", "nl-ind-orientation-year", "nl-ind-researcher"]);
  });

  it("over the shipped state, no Dutch source is named", () => {
    const sources = unreadSources(dataset, state);
    for (const s of sources) expect(FORM_GATED[s.id], `${s.id} is human-tier and in the clause`).toBeUndefined();
    expect(unreadSentence(sources)).not.toMatch(/Dutch/);
    expect(unreadNeverRead(dataset, state)).toEqual([]);
  });
});
