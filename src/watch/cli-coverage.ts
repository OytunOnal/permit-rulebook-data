import { readFileSync } from "node:fs";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "./core.js";
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

process.exit(coverage.ok && quotes.ok ? 0 : 1);
