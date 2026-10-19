import { expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** CRLF is a checkout detail on Windows, not a fact about the file. */
export const readText = (path: string): string => readFileSync(path, "utf8").split("\r\n").join("\n");

/** The workflows, read as text by the tests that hold their decisions. */
export const workflowsDir = fileURLToPath(new URL("../.github/workflows/", import.meta.url));

/** Every workflow file's name in that folder. */
export const workflowFiles: string[] = readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));

/** The watch workflow's text. */
export const watchYaml = readText(join(workflowsDir, "watch.yml"));

/**
 * The lines of one named step, from its `- name:` to the next step at the same
 * indentation. Reading the block rather than the whole file is what lets the
 * ordering inside it be asserted — a guard that runs after the request it is
 * meant to guard is not a guard.
 */
export function stepOf(yaml: string, name: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  expect(start, `no step named "${name}"`).toBeGreaterThan(-1);
  const indent = lines[start].indexOf("-");
  let end = start + 1;
  while (end < lines.length && !/^\s*- name: /.test(lines[end].slice(0, indent + 8))) end += 1;
  return lines.slice(start, end).join("\n");
}

/** One step's `if:` expression, without the `${{ }}` a workflow may wrap it in. */
export function conditionOf(yaml: string, name: string): string {
  const body = stepOf(yaml, name);
  const condition = /^\s*if:\s*(.+)$/m.exec(body);
  expect(condition, `${name} has no condition`).not.toBeNull();
  return condition![1]!.trim().replace(/^\$\{\{/, "").replace(/\}\}$/, "").trim();
}

/** Every step's name, in the order the job runs them. */
export const stepNamesOf = (yaml: string): string[] =>
  [...yaml.matchAll(/^\s*- name: (.+)$/gm)].map((m) => m[1]!.trim());
