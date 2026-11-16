import { readFileSync } from "node:fs";

/** The JSON a repository file holds, at a path relative to `tests/`, as the
 * shape the caller names. A leading byte-order mark is dropped, since
 * `JSON.parse` refuses one. */
export function readJson<Shape = unknown>(path: string): Shape {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8").replace(/^\uFEFF/, ""));
}
