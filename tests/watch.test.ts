import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToText, normalize } from "../src/watch/normalize.js";
import {
  checkCoverage, checkQuotes, datasetLearnUrls, datasetQuotes, datasetSourceUrls, runWatch, sha256,
  type Fetcher, type WatchState, type Watchlist,
} from "../src/watch/core.js";
import type { Dataset } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;
const shippedWatchlist = JSON.parse(readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;

const shippedState = JSON.parse(readFileSync(new URL("../watch/state.json", import.meta.url), "utf8")) as WatchState;

const enc = (s: string) => new TextEncoder().encode(s);
const okFetcher = (pages: Record<string, string | Uint8Array>): Fetcher => async (url) => {
  const body = pages[url];
  if (body === undefined) return { ok: false, status: 403, error: "blocked" };
  return { ok: true, body: typeof body === "string" ? enc(body) : body };
};

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("normalization invariants (property)", () => {
  const rand = lcg(5);
  const words = ["Blaue", "Karte", "45.934,20", "Euro", "§", "18g", "€1.091", "monatlich"];
  const ws = [" ", "  ", "\n", "\t", " ", " \n "];
  const randomDoc = () => {
    let out = "";
    const n = 5 + Math.floor(rand() * 40);
    for (let i = 0; i < n; i++) out += words[Math.floor(rand() * words.length)] + ws[Math.floor(rand() * ws.length)];
    return out;
  };

  it("normalize is idempotent (300 generated docs)", () => {
    for (let i = 0; i < 300; i++) {
      const doc = normalize(randomDoc());
      expect(normalize(doc)).toBe(doc);
    }
  });

  it("whitespace/encoding-only variations never change the hash; one character always does", () => {
    for (let i = 0; i < 300; i++) {
      const doc = randomDoc();
      const spaced = doc.replace(/ /g, "  \n").replace(/€/g, "€");
      expect(sha256(normalize(spaced))).toBe(sha256(normalize(doc)));
      const mutated = normalize(doc).replace("4", "5");
      if (mutated !== normalize(doc)) expect(sha256(mutated)).not.toBe(sha256(normalize(doc)));
    }
  });

  it("htmlToText drops scripts/styles/tags but keeps the text and entities", () => {
    const html = `<html><script>evil()</script><style>.x{}</style><p>kleine&nbsp;Blaue&amp;Karte <b>45.934,20</b>&nbsp;Euro</p>`;
    const text = normalize(htmlToText(html));
    expect(text).toBe("kleine Blaue&Karte 45.934,20 Euro");
    expect(text).not.toContain("evil");
  });

  it("unknown entities stay literal, so distinct texts never hash equal (review #3)", () => {
    const ge = normalize(htmlToText("<p>Gehalt &ge; 45.000</p>"));
    const le = normalize(htmlToText("<p>Gehalt &le; 45.000</p>"));
    expect(ge).not.toBe(le);
    expect(sha256(ge)).not.toBe(sha256(le));
  });

  it("hex numeric entities decode; decimal and hex forms of the same char hash equal", () => {
    const dec = normalize(htmlToText("<p>Preis: &#8364;100</p>"));
    const hex = normalize(htmlToText("<p>Preis: &#x20AC;100</p>"));
    expect(dec).toBe("Preis: €100");
    expect(hex).toBe(dec);
  });

  it("an out-of-range code point stays literal instead of throwing (review #7)", () => {
    expect(() => htmlToText("<p>&#1114112; kaputt</p>")).not.toThrow();
    expect(normalize(htmlToText("<p>&#1114112; kaputt</p>"))).toContain("&#1114112;");
  });
});

describe("watch pass outcomes", () => {
  const list: Watchlist = {
    entries: [
      { id: "page", url: "https://x/page", strategy: "html", kind: "sentinel" },
      { id: "doc", url: "https://x/doc.pdf", strategy: "pdf", kind: "sentinel" },
      { id: "official", url: "https://x/law", strategy: "human", kind: "sentinel", max_age_days: 90, last_verified: "2026-08-01" },
    ],
  };
  const empty: WatchState = { entries: {} };

  it("first run records baselines; second identical run is unchanged", async () => {
    const fetcher = okFetcher({ "https://x/page": "<p>Wert: 100</p>", "https://x/doc.pdf": enc("%PDF-1") });
    const first = await runWatch(list, empty, fetcher, "2026-09-02");
    expect(first.reports.map((r) => r.outcome)).toEqual(["baseline", "baseline", "ok"]);
    const second = await runWatch(list, first.nextState, fetcher, "2026-09-03");
    expect(second.reports.map((r) => r.outcome)).toEqual(["unchanged", "unchanged", "ok"]);
  });

  it("a content change is flagged with both hashes and quoted context", async () => {
    const v1 = okFetcher({ "https://x/page": "<p>Wert: 100 Euro fest</p>", "https://x/doc.pdf": enc("A") });
    const v2 = okFetcher({ "https://x/page": "<p>Wert: 200 Euro fest</p>", "https://x/doc.pdf": enc("A") });
    const { nextState } = await runWatch(list, empty, v1, "2026-09-02");
    const { reports } = await runWatch(list, nextState, v2, "2026-09-03");
    const page = reports.find((r) => r.id === "page")!;
    expect(page.outcome).toBe("changed");
    expect(page.old_hash).not.toBe(page.new_hash);
    expect(page.context).toContain("200 Euro");
  });

  it("whitespace-only page churn does NOT flag (the normalize invariant, end to end)", async () => {
    const v1 = okFetcher({ "https://x/page": "<p>Wert: 100  Euro</p>", "https://x/doc.pdf": enc("A") });
    const v2 = okFetcher({ "https://x/page": "<p>\n  Wert: 100 Euro </p>", "https://x/doc.pdf": enc("A") });
    const { nextState } = await runWatch(list, empty, v1, "2026-09-02");
    const { reports } = await runWatch(list, nextState, v2, "2026-09-03");
    expect(reports.find((r) => r.id === "page")!.outcome).toBe("unchanged");
  });

  it("a blocked fetch is 'unreachable', never 'unchanged', and keeps the old snapshot", async () => {
    const v1 = okFetcher({ "https://x/page": "<p>A</p>", "https://x/doc.pdf": enc("A") });
    const { nextState } = await runWatch(list, empty, v1, "2026-09-02");
    const blocked = okFetcher({ "https://x/doc.pdf": enc("A") }); // page now 403s
    const res = await runWatch(list, nextState, blocked, "2026-09-03");
    const page = res.reports.find((r) => r.id === "page")!;
    expect(page.outcome).toBe("unreachable");
    expect(res.nextState.entries["page"]).toEqual(nextState.entries["page"]);
  });

  it("slice: rotating chrome outside the markers never flags; a change inside does", async () => {
    const sliced: Watchlist = { entries: [
      { id: "p", url: "https://x/p", strategy: "html", kind: "sentinel",
        slice: { from: "Tabelle", to: "Punkte." } },
    ] };
    const ad1 = okFetcher({ "https://x/p": "<p>Anzeige Kaufen!</p><p>Tabelle 1 4 sechs Punkte.</p><p>Footer A</p>" });
    const ad2 = okFetcher({ "https://x/p": "<p>Promo: Jetzt anmelden</p><p>Tabelle 1 4 sechs Punkte.</p><p>Footer B</p>" });
    const law = okFetcher({ "https://x/p": "<p>Anzeige</p><p>Tabelle 1 4 sieben Punkte.</p><p>Footer A</p>" });
    const base = await runWatch(sliced, empty, ad1, "2026-09-02");
    const quiet = await runWatch(sliced, base.nextState, ad2, "2026-09-03");
    expect(quiet.reports[0].outcome).toBe("unchanged");
    const flagged = await runWatch(sliced, base.nextState, law, "2026-09-03");
    expect(flagged.reports[0].outcome).toBe("changed");
  });

  it("slice: a missing marker is 'unreachable', never a quiet 'no change'", async () => {
    const sliced: Watchlist = { entries: [
      { id: "p", url: "https://x/p", strategy: "html", kind: "sentinel",
        slice: { from: "Tabelle", to: "Punkte." } },
    ] };
    const good = okFetcher({ "https://x/p": "<p>Tabelle 1 4 sechs Punkte.</p>" });
    const gutted = okFetcher({ "https://x/p": "<p>Seite nicht gefunden</p>" });
    const base = await runWatch(sliced, empty, good, "2026-09-02");
    const res = await runWatch(sliced, base.nextState, gutted, "2026-09-03");
    expect(res.reports[0].outcome).toBe("unreachable");
    expect(res.reports[0].error).toContain("slice marker missing");
    expect(res.nextState.entries["p"]).toEqual(base.nextState.entries["p"]);
  });

  it("pdf: byte-identical is quiet, byte-different flags (no text extraction attempted)", async () => {
    const v1 = okFetcher({ "https://x/page": "<p>A</p>", "https://x/doc.pdf": enc("PDFv1") });
    const v2 = okFetcher({ "https://x/page": "<p>A</p>", "https://x/doc.pdf": enc("PDFv2") });
    const { nextState } = await runWatch(list, empty, v1, "2026-09-02");
    const { reports } = await runWatch(list, nextState, v2, "2026-09-03");
    const doc = reports.find((r) => r.id === "doc")!;
    expect(doc.outcome).toBe("changed");
    expect(doc.context).toBeUndefined();
  });

  it("human tier: reminder fires only past max_age_days, and nothing is fetched", async () => {
    const neverFetch: Fetcher = async () => { throw new Error("must not fetch human-tier"); };
    const humanOnly: Watchlist = { entries: [list.entries[2]] };
    const fresh = await runWatch(humanOnly, empty, neverFetch, "2026-09-02");
    expect(fresh.reports[0].outcome).toBe("ok"); // 32 days < 90
    const stale = await runWatch(humanOnly, empty, neverFetch, "2026-12-15");
    expect(stale.reports[0].outcome).toBe("reminder-due");
  });

  it("a future last_verified (year typo) reads as fresh, not ancient (review #10)", async () => {
    const neverFetch: Fetcher = async () => { throw new Error("no fetch"); };
    const typo: Watchlist = { entries: [
      { id: "law", url: "https://x/law", strategy: "human", kind: "sentinel", max_age_days: 90, last_verified: "2027-09-02" },
    ] };
    const res = await runWatch(typo, empty, neverFetch, "2026-09-02");
    expect(res.reports[0].outcome).toBe("ok");
  });

  it("runWatch never mutates the input state object", async () => {
    const fetcher = okFetcher({ "https://x/page": "<p>A</p>", "https://x/doc.pdf": enc("A") });
    const frozen = JSON.stringify(empty);
    await runWatch(list, empty, fetcher, "2026-09-02");
    expect(JSON.stringify(empty)).toBe(frozen);
  });
});

describe("coverage: enforced both ways", () => {
  it("the shipped watchlist covers every dataset source and carries no orphans", () => {
    const result = checkCoverage(dataset, shippedWatchlist);
    expect(result.missing_from_watchlist).toEqual([]);
    expect(result.orphan_watch_entries).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("removing any covering watch entry surfaces the uncovered dataset source", () => {
    // Derived, not hard-coded (review #9): pick a real dataset source URL and
    // drop the entry covering it — robust to any future URL migration.
    const someSource = [...datasetSourceUrls(dataset)][0];
    const crippled: Watchlist = { entries: shippedWatchlist.entries.filter((e) => e.url !== someSource) };
    const result = checkCoverage(dataset, crippled);
    expect(result.ok).toBe(false);
    expect(result.missing_from_watchlist).toContain(someSource);
  });

  it("a value-source entry pointing at nothing in the dataset is an orphan", () => {
    const withOrphan: Watchlist = {
      entries: [...shippedWatchlist.entries,
        { id: "stray", url: "https://example.org/x", strategy: "html", kind: "value-source" }],
    };
    const result = checkCoverage(dataset, withOrphan);
    expect(result.ok).toBe(false);
    expect(result.orphan_watch_entries).toEqual(["stray"]);
  });

  it("sentinels are exempt from the orphan rule", () => {
    const withSentinel: Watchlist = {
      entries: [...shippedWatchlist.entries,
        { id: "idx", url: "https://example.org/index", strategy: "html", kind: "sentinel" }],
    };
    expect(checkCoverage(dataset, withSentinel).orphan_watch_entries).toEqual([]);
  });
});

/**
 * The one-pager's second non-negotiable: every value carries its source.
 *
 * This is that promise's check, and it is a symptom check, not a surface one —
 * it does not ask whether a `source_url` field is filled in, it asks whether
 * the sentence the dataset claims to have quoted is still in the snapshot of
 * the page it cites. A reworded page that keeps its byte count, or a quote
 * edited on our side, fails here (human, 2026-09-08).
 */
describe("the one-pager's promise: every value carries its source, and the sentence is still on the page", () => {
  it("every shipped quote is found in the snapshot of the source it cites", () => {
    const r = checkQuotes(dataset, shippedWatchlist, shippedState);
    expect(r.missing).toEqual([]);
    expect(r.verified).toBeGreaterThan(0);
  });

  it("PDF-tier sources are reported unverifiable, never counted as verified", () => {
    const r = checkQuotes(dataset, shippedWatchlist, shippedState);
    // "no text snapshot" is the fourth honest answer: a source added to the
    // watchlist since the last watch run has nothing to check against yet
    // (§ 20a joined it 2026-09-07). It is still named, never silently passed.
    expect(r.unverifiable.every((u) => /pdf tier|not on the watchlist|human tier|no text snapshot/.test(u.reason))).toBe(true);
    for (const u of r.unverifiable) expect(u.reason.length).toBeGreaterThan(4);
  });

  it("a quote the page no longer carries fails the gate", () => {
    const broken = structuredClone(dataset);
    broken.notices![0].source.quote = "As an EU national you must apply for a work permit.";
    const r = checkQuotes(broken, shippedWatchlist, shippedState);
    expect(r.ok).toBe(false);
    expect(r.missing.map((m) => m.where)).toContain("notice:" + broken.notices![0].id);
  });

  it("tolerates only our own extraction artifacts, not different words", () => {
    const state: WatchState = { entries: { p: { hash: "x", retrieved_at: "2026-09-04",
      text: "muss das Gehalt mindestens 45.630Euro im Jahr 2026 erreichen . Ende", history: [] } } };
    const list: Watchlist = { entries: [{ id: "p", url: "https://x/p", strategy: "html", kind: "value-source" }] };
    const ds = structuredClone(dataset);
    ds.countries = []; ds.notices = [{ ...dataset.notices![0], id: "t",
      source: { ...dataset.notices![0].source, source_url: "https://x/p",
        quote: "muss das Gehalt mindestens 45.630 Euro im Jahr 2026 erreichen." } }];
    expect(checkQuotes(ds, list, state).ok).toBe(true);
    ds.notices![0].source.quote = "muss das Gehalt mindestens 45.640 Euro im Jahr 2026 erreichen.";
    expect(checkQuotes(ds, list, state).ok).toBe(false);
  });

  it("stored snapshots are decoded text, not double-encoded mojibake", () => {
    // A cp1252 round-trip once turned "beträgt" into "betrÃ¤gt" in state.json:
    // hashes survived (computed per run) but every flag diff became unreadable.
    for (const [id, snap] of Object.entries(shippedState.entries))
      expect(/Ã¤|Ã¶|Ã¼|ÃŸ|â€ž|â‚¬/.test(snap.text ?? ""), id).toBe(false);
  });
});


/**
 * The failure this guards against is not a page that goes away — that is
 * already `unreachable`. It is a page that answers 200 with a body that is not
 * the page.
 *
 * On 2026-09-07 a bare fetch of the IND orientation-year URL returned a 1.4 kB
 * shell twice, with and without a browser User-Agent, while the watch fetcher
 * had taken the full 17 kB document from the same host; a fetch from here on
 * 2026-09-07 returned the full 34 kB page again. Nobody has established why,
 * and an intermittent shell is worse than a permanent one: it lands on a
 * `--commit` run eventually.
 *
 * Without a marker the shell hashes cleanly, so the entry reports `changed`,
 * `--commit` writes the shell in as `text`, and the next `npm run check` puts
 * every quote on that page into `missing` — the flag that tells a curator the
 * page was rewritten and the dataset should be rewritten after it. Around half
 * the dataset's verified quotes are IND-hosted. The marker is what turns that
 * into `unreachable`.
 */
describe("a page that answers with a shell is unreachable, not changed", () => {
  /** Hosts observed to answer this machine with something that is not the
   * page: ind.nl served the shell above, and bamf.de refused connections
   * outright earlier the same day and answers now. Both back values a card
   * prints, so a wrong "no change" from either is a wrong answer to a person. */
  const SHELL_PRONE = ["ind.nl", "bamf.de"];

  const proneEntries = () =>
    shippedWatchlist.entries.filter(
      (e) => e.strategy === "html" && SHELL_PRONE.some((h) => new URL(e.url).hostname.endsWith(h)),
    );

  /** A single-page-app shell of about 1.4 kB: right title, right chrome, no page. */
  const shell = (title: string) =>
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${title}</title><link rel="stylesheet" href="/assets/app.css">` +
    '<script src="/assets/app.js" defer></script></head><body>' +
    '<div id="root"></div><noscript>You need JavaScript enabled to view this site.</noscript>' +
    `<!--${" padding".repeat(150)}--></body></html>`;

  it("every watched page on such a host carries a slice marker", () => {
    for (const e of proneEntries())
      expect(e.slice, `${e.id}: no slice marker — a shell from here would report as a change`).toBeDefined();
    expect(proneEntries().length).toBeGreaterThanOrEqual(10);
  });

  it("the markers bracket every quote the dataset takes from those pages", () => {
    // Slice each shipped snapshot the way a watch pass would and check the
    // quotes against the region alone: a marker that cut a quote out of the
    // watched region would make the slice itself the thing that reports the
    // quote missing, which is the same wrong answer by another route.
    const sliced: WatchState = { entries: { ...shippedState.entries } };
    for (const e of proneEntries()) {
      const snap = shippedState.entries[e.id];
      expect(snap?.text, `${e.id}: no snapshot to check the markers against`).toBeDefined();
      const from = snap!.text!.indexOf(e.slice!.from);
      const to = from >= 0 ? snap!.text!.indexOf(e.slice!.to, from + e.slice!.from.length) : -1;
      expect(from, `${e.id}: the "from" marker is not in the snapshot`).toBeGreaterThanOrEqual(0);
      expect(to, `${e.id}: the "to" marker is not after "from" in the snapshot`).toBeGreaterThan(from);
      sliced.entries[e.id] = { ...snap!, text: snap!.text!.slice(from, to + e.slice!.to.length) };
    }
    expect(checkQuotes(dataset, shippedWatchlist, sliced).missing).toEqual([]);
  });

  it("a shell reports unreachable, leaves the snapshot alone, and the quotes stay verified", async () => {
    const entry = shippedWatchlist.entries.find((e) => e.id === "nl-ind-orientation-year")!;
    const before = checkQuotes(dataset, shippedWatchlist, shippedState);
    const list: Watchlist = { entries: [entry] };
    const { reports, nextState } = await runWatch(
      list, shippedState,
      okFetcher({ [entry.url]: shell("Residence permit for orientation year | IND") }),
      "2026-09-08",
    );

    expect(reports[0].outcome).toBe("unreachable");
    expect(reports[0].error).toContain("slice marker missing");
    // Not merely "not committed": the state a --commit run would write carries
    // the snapshot that was already there, byte for byte.
    expect(nextState.entries[entry.id]).toEqual(shippedState.entries[entry.id]);

    const after = checkQuotes(dataset, shippedWatchlist, nextState);
    expect(after.missing).toEqual([]);
    expect(after.verified).toBe(before.verified);
    const onThatPage = datasetQuotes(dataset).filter((q) => q.source_url === entry.url);
    expect(onThatPage.length).toBeGreaterThan(0);
  });

  it("without the marker the same shell reports 'changed' — which is why the marker is there", async () => {
    // The counterfactual, kept executable: this is what the watchlist did
    // before this review, and the flag file it would have produced.
    const entry = shippedWatchlist.entries.find((e) => e.id === "nl-ind-orientation-year")!;
    const unsliced: Watchlist = { entries: [{ ...entry, slice: undefined }] };
    const { reports, nextState } = await runWatch(
      unsliced, shippedState,
      okFetcher({ [entry.url]: shell("Residence permit for orientation year | IND") }),
      "2026-09-08",
    );
    expect(reports[0].outcome).toBe("changed");
    expect(nextState.entries[entry.id]!.text!.length).toBeLessThan(200);
    // …and every quote on the page is then reported missing, which reads as
    // "the page was rewritten, rewrite the dataset after it".
    const wrecked = checkQuotes(dataset, unsliced, nextState);
    expect(wrecked.missing.length).toBeGreaterThan(0);
    expect(wrecked.missing.every((m) => m.source_url === entry.url)).toBe(true);
  });
});

describe("learn links are watched for liveness, and only for liveness", () => {
  it("every 'find out yourself' link is on the watchlist", () => {
    // The link is a promise to the one person who answered "I don't know".
    // Nothing watched them until a human clicked one and found it dead.
    const watched = new Set(shippedWatchlist.entries.map((e) => e.url));
    for (const url of datasetLearnUrls(dataset)) expect([...watched], url).toContain(url);
  });

  it("coverage fails when a learn link loses its watch entry", () => {
    const stripped: Watchlist = {
      entries: shippedWatchlist.entries.filter((e) => e.id !== "learn-anabin"),
    };
    const result = checkCoverage(dataset, stripped);
    expect(result.ok).toBe(false);
    expect(result.missing_from_watchlist).toContain("https://anabin.kmk.org/anabin.html");
  });

  it("a watched learn link is never an orphan — it backs no value by design", () => {
    expect(checkCoverage(dataset, shippedWatchlist).orphan_watch_entries).toEqual([]);
  });

  it("reports ok while it answers, unreachable when it stops", async () => {
    const list: Watchlist = { entries: shippedWatchlist.entries.filter((e) => e.strategy === "link") };
    expect(list.entries.length).toBeGreaterThan(0);

    const alive = await runWatch(list, { entries: {} },
      async () => ({ ok: true, body: new TextEncoder().encode("<html>anything at all</html>") }),
      "2026-09-06");
    expect(alive.reports.map((r) => r.outcome)).toEqual(list.entries.map(() => "ok"));
    // Liveness only: rewording the page is not news, so nothing is stored.
    expect(alive.nextState.entries).toEqual({});

    const dead = await runWatch(list, { entries: {} },
      async () => ({ ok: false, error: "connect ETIMEDOUT" }),
      "2026-09-06");
    expect(dead.reports.map((r) => r.outcome)).toEqual(list.entries.map(() => "unreachable"));
  });

  it("a learn link never claims a quote", () => {
    // checkQuotes walks value sources; a link tier entry must not appear there
    // as unverifiable noise that trains us to ignore the list.
    const quoteUrls = new Set(datasetQuotes(dataset).map((q) => q.source_url));
    for (const e of shippedWatchlist.entries.filter((x) => x.strategy === "link"))
      expect([...quoteUrls], e.id).not.toContain(e.url);
  });
});

/**
 * The slice that was widened on 2026-09-08, and why it must stay where it is.
 *
 * The IND states, above its requirement list, that a person on a contract with
 * a company outside the EU who is being transferred as a manager, specialist or
 * trainee is an intra corporate transferee and other requirements apply. That
 * sentence changes who each highly-skilled-migrant route is for, and it sat 64
 * characters above the old `from` marker, where nothing watched it. The marker
 * moved down to the page's own lede — below the rotating mega-menu, and below
 * the page's "Last update" date, which would otherwise flag every day.
 */
describe("the highly-skilled-migrant slice", () => {
  const entry = shippedWatchlist.entries
    .find((e) => e.id === "nl-ind-highly-skilled-migrant")!;
  const snapshot = shippedState.entries["nl-ind-highly-skilled-migrant"];
  const SENTENCE = "Do you have an employment contract with a company located outside the EU?"
    + " And are you going to be transferred as a manager, specialist or trainee?"
    + " Then you are an intra corporate transferee and other requirements apply to you.";

  it("starts at the lede, so the sentence is inside it", () => {
    expect(entry.slice?.from).toBe("To work in the Netherlands as a highly skilled migrant");
    expect(snapshot.text, "the snapshot predates the widened slice").toContain(SENTENCE);
    // Everything the old, narrower slice covered is still covered.
    expect(snapshot.text).toContain("Requirements");
  });

  it("keeps the page's own date outside it, or the entry flags every day", () => {
    expect(snapshot.text).not.toContain("Last update");
    expect(entry.slice?.from.startsWith("Last update")).toBe(false);
  });

  it("records that a person moved the marker, so the flag is not read as the page changing", () => {
    const moved = entry.history?.find((h) => h.changed_at === "2026-09-08");
    expect(moved, "a deliberate slice change with no history entry").toBeDefined();
    expect(moved!.note).toMatch(/intra corporate transferee/i);
    expect(moved!.note).toMatch(/moved/i);
  });

  it("the quote the widened slice exists for is in the dataset, dated the day it was read", () => {
    const routes = dataset.countries.flatMap((c) => c.routes);
    for (const id of ["nl-hsm-30plus", "nl-hsm-under30"]) {
      const statement = routes.find((r) => r.id === id)!
        .statements!.find((s) => s.id === "a-contract-abroad-is-a-transfer");
      expect(statement, `${id} does not carry it`).toBeDefined();
      expect(statement!.source!.quote).toBe(SENTENCE);
      expect(statement!.source!.retrieved_at).toBe("2026-09-08");
      expect(statement!.source!.source_url).toBe(entry.url);
      // It is a caveat, not a precondition: the interview DOES ask this, as
      // `situation eq offer`, so it is the source qualifying its own answer
      // rather than a condition nobody asks about.
      expect(statement!.kind).toBe("caveat");
    }
  });
});

/**
 * The FR talent fiche's slice, bounded on 2026-09-08, and why it must stay so.
 *
 * The entry hashed the whole page — 87,303 characters of it — so anything on
 * the fiche could move it. On 2026-09-05 something did: the Allô Service Public
 * contact panel, whose "Horaires exceptionnels le mardi 8 septembre" line
 * changes with the calendar. Quote fidelity verified every FR quote against the
 * new snapshot that same day and still does, so nothing had happened to a
 * value. The slice is now the accordions the entry's own intent names.
 */
describe("the FR talent fiche's slice", () => {
  const entry = shippedWatchlist.entries.find((e) => e.id === "fr-f16922-talent")!;
  const snapshot = shippedState.entries["fr-f16922-talent"];

  it("is bounded to the accordions, not the whole fiche", () => {
    expect(entry.slice?.from).toBe("Salarié qualifié");
    expect(entry.slice?.to).toBe("Faire la démarche auprès de la préfecture");
    expect(snapshot.text!.length).toBeLessThan(30_000);
  });

  it("keeps the opening-hours widget out of the hash", () => {
    for (const outside of ["horaires", "Horaires exceptionnels", "Allô Service Public", "Trouver un interlocuteur"])
      expect(snapshot.text, `${outside} is inside the slice`).not.toContain(outside);
  });

  it("still carries every talent amount the entry exists for", () => {
    for (const amount of ["39 582", "59 373", "41 386"])
      expect(snapshot.text, amount).toContain(amount);
  });

  it("and every quote citing the fiche still verifies against it", () => {
    const url = "https://www.service-public.gouv.fr/particuliers/vosdroits/F16922";
    const cited = datasetQuotes(dataset).filter((q) => q.source_url === url);
    expect(cited.length).toBeGreaterThan(5);
    const missing = checkQuotes(dataset, shippedWatchlist, shippedState).missing
      .filter((m) => m.source_url === url);
    expect(missing).toEqual([]);
  });

  it("records that a person bounded it, so the flag is not read as the page changing", () => {
    const bounded = entry.history?.find((h) => h.changed_at === "2026-09-08");
    expect(bounded, "a deliberate slice change with no history entry").toBeDefined();
    expect(bounded!.note).toMatch(/opening-hours/i);
    expect(bounded!.note).toMatch(/false alarm/i);
  });
});

/**
 * The buzer.de statute mirrors, bounded on 2026-09-08.
 *
 * Three of the four entries hashed the whole page. On 2026-09-08 the daily cron
 * flagged § 6 BeschV as changed and the excerpt was buzer's own furniture —
 * "m.W.v. 1. März 2024 § 5 ← → § 7 Anzeige Inhaltsverzeichnis | Ausdrucken/PDF
 * | nach oben Frühere Fassungen von § 6 BeschV". The human fetched the live
 * page: both quotes verbatim, statute version unchanged. So the watched region
 * is now the statute body, from the first Absatz to the end of the last one.
 *
 * The snapshots in the tree predate the re-baseline — that is the human's, after
 * the cron's commit is merged — so these cases apply each entry's markers to the
 * snapshot the way the watch does, and read what the hash would then cover.
 */
describe("the buzer statute slices", () => {
  /** What the watch hashes: the region between the markers, inclusive. */
  const watched = (id: string): string => {
    const entry = shippedWatchlist.entries.find((e) => e.id === id)!;
    const text = shippedState.entries[id]!.text!;
    expect(entry.slice, `${id} has no slice`).toBeDefined();
    const from = text.indexOf(entry.slice!.from);
    expect(from, `${id}: "from" marker missing`).toBeGreaterThanOrEqual(0);
    const to = text.indexOf(entry.slice!.to, from + entry.slice!.from.length);
    expect(to, `${id}: "to" marker missing`).toBeGreaterThanOrEqual(0);
    return text.slice(from, to + entry.slice!.to.length);
  };

  const IDS = ["buzer-6-beschv", "buzer-20a-aufenthg", "buzer-anlage-aufenthg"];

  it("leaves buzer's navigation, ad blocks and version counters outside the hash", () => {
    for (const id of IDS) {
      const cut = watched(id);
      for (const furniture of [
        "Frühere Fassungen", "Inhaltsverzeichnis", "Ausdrucken/PDF", "nach oben",
        "Werben auf buzer.de", "Rechtskataster", "Mail bei Änderungen", "← →",
      ])
        expect(cut, `${id}: "${furniture}" is inside the slice`).not.toContain(furniture);
    }
  });

  it("still covers every sentence the dataset quotes from those pages", () => {
    const byId = new Map(IDS.map((id) => [
      shippedWatchlist.entries.find((e) => e.id === id)!.url, watched(id),
    ]));
    let checked = 0;
    for (const q of datasetQuotes(dataset)) {
      const cut = byId.get(q.source_url);
      if (!cut) continue;
      checked++;
      expect(cut, `${q.where}: the quote fell outside the slice`).toContain(q.quote);
    }
    expect(checked, "no dataset quote cites a buzer page any more").toBeGreaterThan(3);
  });

  it("watches less of each page than before, and still the whole statute", () => {
    // Statute body only: a page of navigation is not a page of law.
    for (const id of IDS) {
      const cut = watched(id);
      expect(cut.length, id).toBeLessThan(shippedState.entries[id]!.text!.length + 1);
      expect(cut.length, `${id} watches nothing`).toBeGreaterThan(150);
    }
  });

  it("records that a person bounded them, so the next flag is not read as the page changing", () => {
    for (const id of IDS) {
      const entry = shippedWatchlist.entries.find((e) => e.id === id)!;
      const bounded = entry.history?.find((h) => h.changed_at === "2026-09-08");
      expect(bounded, `${id}: a deliberate slice change with no history entry`).toBeDefined();
      expect(bounded!.note).toMatch(/quote fidelity/i);
    }
    const beschv = shippedWatchlist.entries.find((e) => e.id === "buzer-6-beschv")!;
    expect(beschv.history![0]!.note).toMatch(/not the law/i);
  });
});

/**
 * A flag is a dated observation, and an observation is not edited.
 *
 * The re-baseline that followed the § 6 BeschV false alarm rewrote the flag's
 * own `old:`/`new:` hashes to the pair the new slice produced — so the file no
 * longer said what had actually been seen, and the excerpt no longer showed the
 * furniture that raised it (Standards review, 2026-09-08). A resolution is
 * something appended with a date; the header is what the run wrote.
 */
/** A checkout detail on Windows, not a fact about a file. */
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const LF = String.fromCharCode(10);

describe("a resolved flag still says what it saw", () => {
  const flagsDir = fileURLToPath(new URL("../watch/flags/", import.meta.url));
  const flags = readdirSync(flagsDir).filter((f) => f.endsWith(".md"));

  it("every flag keeps a header its run wrote, with both hashes", () => {
    expect(flags.length).toBeGreaterThan(3);
    for (const name of flags) {
      const text = readFileSync(join(flagsDir, name), "utf8").split(CRLF).join(LF);
      const header = text.slice(0, text.indexOf(LF + LF));
      expect(header, `${name}: no url`).toMatch(/^- url: http/m);
      expect(header, `${name}: no date`).toMatch(/^- date: [0-9]{4}-[0-9]{2}-[0-9]{2}$/m);
      const hashes = header.match(/^- (old|new): ([0-9a-f]{64})$/gm) ?? [];
      // A first sighting has no `old`; a change has both.
      expect(hashes.length, `${name}: header hashes are missing or malformed`).toBeGreaterThan(0);
      // Anything a person adds comes after the machine's own lines.
      const resolved = text.indexOf("## Resolved");
      if (resolved >= 0) expect(resolved, `${name}: a resolution above the record`).toBeGreaterThan(header.length);
    }
  });

  it("the § 6 BeschV flag still carries the pair and the excerpt that raised it", () => {
    const text = readFileSync(join(flagsDir, "buzer-6-beschv-2026-09-08.md"), "utf8")
      .split(CRLF).join(LF);
    // The hashes the run that raised it recorded — the whole page, before and
    // after the furniture moved.
    expect(text).toContain("- old: 2d6e50243e606ab0c8f3784a88fedd27ca038ca25daa236a5865b5118a11b10a");
    expect(text).toContain("- new: f81cdc992a27dfdbbd428b277139b5c4dbf3f5de139013500b6f8c7947f808a5");
    // And the furniture itself, which is the evidence for calling it one.
    expect(text).toContain("Inhaltsverzeichnis | Ausdrucken/PDF");
    expect(text).toContain("## Resolved — 2026-09-08");
    // The re-baseline is recorded as prose, under the resolution.
    const resolution = text.slice(text.indexOf("## Resolved"));
    expect(resolution).toContain("2bbd20d8bc77277490c710df1b7f3d0059e0971e328314afd006d0aa8e23d107");
  });
});
