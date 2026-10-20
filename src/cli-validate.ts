import { readFileSync } from "node:fs";
import { validateDataset } from "./validate.js";
import { datasetMeta } from "./engine.js";
import type { Dataset } from "./types.js";
import { print } from "./watch/print.js";

const path = process.argv[2];
if (!path) {
  print({ level: "error", msg: "usage: cli-validate <dataset.json>", fields: {} });
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  print({ level: "error", msg: "dataset unreadable", fields: { path, error: String(e) } });
  process.exit(1);
}

const result = validateDataset(raw);
if (!result.ok) {
  for (const err of result.errors) print({ level: "error", msg: "schema violation", fields: { path: err.path, detail: err.message, keyword: err.keyword } });
  print({ level: "error", msg: "dataset INVALID", fields: { file: path, errors: result.errors.length } });
  process.exit(1);
}

const meta = datasetMeta(raw as Dataset);
print({ level: "info", msg: "dataset valid", fields: { file: path, ...meta } });
