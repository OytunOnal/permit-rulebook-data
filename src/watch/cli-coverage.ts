import { readFileSync } from "node:fs";
import { checkCoverage, checkQuotes, type WatchState, type Watchlist } from "./core.js";
import { proseProvenance } from "../prose.js";
import { unreadNeverRead, unreadSources } from "./state.js";
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
/**
 * What the last run did not read, of the sources a reader is looking at.
 *
 * Not a gate — a run that could not reach a source has already failed with its
 * own exit code, and this file's two gates are about the dataset. It is a
 * measurement a person reads on every `npm run check`, and it is here because
 * the alternative is that the only way to know which sources went unread is to
 * open `/data/` in a browser. `never_read` is the half the page cannot say:
 * a source that has never been read has no day to have not answered since
 * (Standards review, 2026-09-15).
 */
const unread = unreadSources(dataset, state);
const neverRead = unreadNeverRead(dataset, state);
console.log(JSON.stringify({
  ts: ts(),
  level: unread.length || neverRead.length ? "warn" : "info",
  msg: "unread sources",
  last_run: state.last_run ?? null,
  reported: unread.map((u) => ({ id: u.id, last_read: u.last_read, countries: u.countries })),
  never_read: neverRead.map((e) => e.id),
}));

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
