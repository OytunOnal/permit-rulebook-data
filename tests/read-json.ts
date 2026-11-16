import { readFileSync } from "node:fs";

/** The JSON a repository file holds, at a path relative to `tests/`. A
 * leading byte-order mark is dropped, since `JSON.parse` refuses one. */
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8").replace(/^﻿/, ""));
}
