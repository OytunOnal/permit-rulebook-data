import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { htmlToText, normalize } from "../src/watch/normalize.js";
import {
  checkCoverage, runWatch, sha256,
  type Fetcher, type WatchState, type Watchlist,
} from "../src/watch/core.js";
import type { Dataset } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/de.json", import.meta.url), "utf8")) as Dataset;
const shippedWatchlist = JSON.parse(readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;

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

  it("removing a watch entry surfaces the uncovered dataset source", () => {
    const crippled: Watchlist = { entries: shippedWatchlist.entries.filter((e) => !e.url.includes("kairo")) };
    const result = checkCoverage(dataset, crippled);
    expect(result.ok).toBe(false);
    expect(result.missing_from_watchlist.some((u) => u.includes("kairo"))).toBe(true);
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
