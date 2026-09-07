import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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

describe("quote fidelity: the sentence is still on the page", () => {
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
