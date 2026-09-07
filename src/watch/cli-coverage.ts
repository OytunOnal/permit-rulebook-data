import { readFileSync } from "node:fs";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "./core.js";
import { proseProvenance } from "../prose.js";
import type { Dataset } from "../types.js";

const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));
const dataset = readJson(new URL("../../../data/dataset.json", import.meta.url)) as Dataset;
const watchlist = readJson(new URL("../../../watch/watchlist.json", import.meta.url)) as Watchlist;
const state = readJson(new URL("../../../watch/state.json", import.meta.url)) as WatchState;

const ts = () => new Date().toISOString();

const coverage = checkCoverage(dataset, watchlist);
console.log(JSON.stringify({ ts: ts(), level: coverage.ok ? "info" : "error", msg: "watch coverage", ...coverage }));

// Coverage says the source is watched; this says the quote is still on it.
const quotes = checkQuotes(dataset, watchlist, state);
console.log(JSON.stringify({
  ts: ts(),
  level: quotes.ok ? "info" : "error",
  msg: "quote fidelity",
  ok: quotes.ok,
  verified: quotes.verified,
  missing: quotes.missing.map((m) => ({ where: m.where, quote: m.quote })),
  unverifiable: quotes.unverifiable.map((u) => ({ where: u.where, reason: u.reason })),
}));

/**
 * Where the dataset's sentences stand. s5e step 1 asked for this number to be
 * "reported, not hidden", and it was pinned in a test and nowhere else — a
 * count only a test reads is reported to nobody (review 2026-09-07). It is not
 * a gate: nothing here can fail, it is a measurement a person reads on every
 * `npm run check`.
 */
const prose = proseProvenance(dataset);
console.log(JSON.stringify({
  ts: ts(),
  level: "info",
  msg: "prose provenance",
  // An authority is shown to have said it.
  with_provenance: prose.with_provenance,
  // Ours, declared as ours, rendered to the reader as ours.
  ours: prose.ours,
  // Standing on a declared, dated reason no quote could be found.
  declared_unsourced: prose.declared_unsourced,
  // Quotes no machine here can check against a snapshot — the human tier,
  // whose checklist is data/verify-s5e.md.
  human_tier: quotes.unverifiable.length,
}));

process.exit(coverage.ok && quotes.ok ? 0 : 1);
