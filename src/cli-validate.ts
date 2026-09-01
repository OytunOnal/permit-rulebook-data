import { readFileSync } from "node:fs";
import { validateDataset } from "./validate.js";
import { datasetMeta } from "./engine.js";
import type { Dataset } from "./types.js";

// Structured (ndjson) logs: one JSON object per line, machine- and grep-friendly.
function log(level: "info" | "error", msg: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra });
  if (level === "error") console.error(line);
  else console.log(line);
}

const path = process.argv[2];
if (!path) {
  log("error", "usage: cli-validate <dataset.json>");
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  log("error", "dataset unreadable", { path, error: String(e) });
  process.exit(1);
}

const result = validateDataset(raw);
if (!result.ok) {
  for (const err of result.errors) log("error", "schema violation", { path: err.path, detail: err.message, keyword: err.keyword });
  log("error", "dataset INVALID", { file: path, errors: result.errors.length });
  process.exit(1);
}

const meta = datasetMeta(raw as Dataset);
log("info", "dataset valid", { file: path, ...meta });
