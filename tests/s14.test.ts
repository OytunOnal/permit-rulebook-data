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
 *
 * **s34, 2026-09-23, retired the half of this file that said the five are
 * unreadable.** They were unreadable by a `fetch`; the watch now opens them in
 * a browser. Every case this slice inverted was removed here and replaced, by
 * name, in `tests/s34.test.ts` — each removal below says which case it was and
 * what replaced it. What stays is what is still true: the two IND pages s14
 * never touched, the marker a person moved on 2026-09-08, the checklist that
 * records the human read, and s11's sentence.
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

const entryOf = (id: string) => watchlist.entries.find((e) => e.id === id)!;

describe("s14 — what is left of the form-gated tier after s34 took the five back", () => {
  // RETIRED BY s34: "each takes the human strategy, a quarterly age and a read
  // date, and loses its slice". The five are browser entries now, with a slice
  // and no verification age — replaced by s34's "each of the seven is a
  // browser entry with a slice, a history line and no verification age".
  //
  // RETIRED BY s34: "each note says what it backs, why a person, the
  // measurement, the road back and the re-read". The notes were rewritten to
  // say what the fetch does and what the browser does — replaced by s34's
  // "each of the seven says what the fetch got, what the browser gets, and the
  // day each was measured". What the entry backs is still asserted there.
  //
  // RETIRED IN PART BY s34: "the two bot-gated entries of 2026-09-10 are the
  // template and are unchanged". EUR-Lex left the tier — a browser passes its
  // challenge — and is in s34's seven. Legifrance is still there, and is now
  // the only sentence on the tier, so the case below keeps the half that is
  // still true.
  it("Legifrance, the one bot-gated entry a browser does not open either, is unchanged", () => {
    const entry = entryOf("legifrance-ce-algerian-titles");
    expect(entry.strategy).toBe("human");
    expect(entry.max_age_days).toBe(90);
    expect(entry.last_verified).toBe("2026-09-10");
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

// RETIRED BY s34: the whole of "s14 — the state carries no stale IND
// snapshot", both cases. "Represents the five the way it represents every
// human-tier entry: absent" and "names none of the five as unread — a page a
// person reads was never a machine read" were promises that the state holds
// nothing for these pages. It holds a text snapshot for each of them now,
// which is the point of s34 — replaced by s34's "the state carries a text
// snapshot for each of the seven, and the quote gate reads it".

describe("s14 — the quote gate stays green through the move", () => {
  const result = checkQuotes(dataset, watchlist, state);
  const humanReason = STRATEGIES.human.no_text_snapshot;

  it("is green: nothing is missing, and coverage holds both ways", () => {
    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
    expect(checkCoverage(dataset, watchlist).ok).toBe(true);
  });

  // RETIRED BY s34: "the unverifiable set is exactly the form-gated quotes
  // plus the two bot-gated ones, all with the human reason". Thirty-nine of
  // those forty quotes are verified against a browser snapshot now, and the
  // tier holds one — replaced by s34's "the quote gate reads the seven:
  // human_tier falls to one, and verified rises by exactly the thirty-nine".
  // The count the case established — the five pages back 38 quotes, 12/8/7/6/5
  // — moved there with it, still counted from the dataset.

  // RETIRED BY s34: "verified drops by exactly what the stale snapshots had
  // been vouching for". The number it pinned, 145 + 9 + 2, was the count with
  // the thirty-eight IND sentences off the books; they are back on them, and
  // pinning the new total here would be pinning it twice — s34 asserts the
  // decision instead (nothing unverifiable on the seven, one sentence left on
  // the tier). The history the comment carried stays worth reading: 171 before
  // the move, 145 after the stale snapshots left, +9 at s19, +2 at s29.
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

// RETIRED BY s34: the whole of "s14 — the watch runs green with the five on
// the human arm", both cases. "Fetches nothing for them, reports ok, and
// leaves no unread IND entry" and "a quarter later the reminder fires, which
// is the re-read the notes promise" were promises that these five are never
// read by a machine and are chased by a reminder instead. They are read every
// morning now, and no reminder is due on them ever again — replaced by s34's
// "a run with no browser reads the rest and goes red on the seven" and by the
// live run the slice is merged on.

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
