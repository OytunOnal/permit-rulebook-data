import { readFileSync } from "node:fs";
import { checkCoverage, type Watchlist } from "./core.js";
import type { Dataset } from "../types.js";

const readJson = (url: URL) => JSON.parse(readFileSync(url, "utf8").replace(/^﻿/, ""));
const dataset = readJson(new URL("../../../data/de.json", import.meta.url)) as Dataset;
const watchlist = readJson(new URL("../../../watch/watchlist.json", import.meta.url)) as Watchlist;

const result = checkCoverage(dataset, watchlist);
console.log(JSON.stringify({ ts: new Date().toISOString(), level: result.ok ? "info" : "error", msg: "watch coverage", ...result }));
process.exit(result.ok ? 0 : 1);
