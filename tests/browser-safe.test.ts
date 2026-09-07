import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Nothing the package's entry point reaches may import a Node built-in.
 *
 * The site's interview is a `<script>` in the browser and it imports this
 * package. On 2026-09-07 `src/exclusions.ts` was added to the entry point with
 * `import { readFileSync } from "node:fs"` at the top; the bundler externalises
 * that for the browser, the module threw on import, and the interview rendered
 * no question at all — an empty page with an empty "You declared" box. Every
 * test passed, because every test runs in Node.
 *
 * This walks the import graph from `src/index.ts` and fails on the offending
 * import itself, so the next one is caught before anybody opens a browser. It is
 * the cheap half of the pair; `permit-rulebook`'s browser smoke test is the half
 * that proves the page actually runs.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

/** Comments are prose: a sentence about `node:fs` is not an import of it. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

const IMPORT_SPECIFIER = /(?:^|\s)(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g;
const BARE_IMPORT = /(?:^|\s)import\s*["']([^"']+)["']/g;
const REQUIRE_CALL = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(code: string): string[] {
  const clean = withoutComments(code);
  return [
    ...[...clean.matchAll(IMPORT_SPECIFIER)].map((m) => m[1]),
    ...[...clean.matchAll(BARE_IMPORT)].map((m) => m[1]),
    ...[...clean.matchAll(REQUIRE_CALL)].map((m) => m[1]),
  ];
}

/** A relative specifier, resolved the way the build resolves it: `./x.js` is
 * `x.ts` on disk. Anything else is a package or a built-in. */
function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const target = resolve(dirname(from), specifier);
  for (const candidate of [target.replace(/\.js$/, ".ts"), `${target}.ts`, join(target, "index.ts")])
    try { readFileSync(candidate, "utf8"); return candidate; } catch { /* next */ }
  throw new Error(`${from} imports ${specifier}, which resolves to nothing on disk`);
}

/** Every module the entry point can reach, and every non-relative specifier. */
function reachable(entry: string): { files: string[]; packages: Map<string, string[]> } {
  const files: string[] = [];
  const packages = new Map<string, string[]>();
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const local = resolveLocal(file, specifier);
      if (local) { queue.push(local); continue; }
      packages.set(specifier, [...(packages.get(specifier) ?? []), file]);
    }
  }
  return { files, packages };
}

describe("the package a browser imports", () => {
  const { files, packages } = reachable(join(SRC, "index.ts"));

  it("reaches the modules it is supposed to", () => {
    // A guard that walked nothing would pass silently.
    expect(files.length).toBeGreaterThan(8);
    const names = files.map((f) => f.split(String.fromCharCode(92)).join("/"));
    for (const module of ["engine.ts", "verdict.ts", "prose.ts", "scope.ts", "exclusions.ts", "lang.ts"])
      expect(names.some((n) => n.endsWith(`/src/${module}`)), module).toBe(true);
  });

  it("imports no Node built-in, anywhere in that graph", () => {
    const offenders = [...packages.entries()]
      .filter(([specifier]) => specifier.startsWith("node:"))
      .map(([specifier, importers]) => `${specifier} <- ${importers.join(", ")}`);
    expect(offenders).toEqual([]);
  });

  it("imports nothing but its own declared dependency", () => {
    // ajv is a dependency in package.json and ships browser builds; anything
    // else appearing here is a new dependency nobody declared.
    const outside = [...packages.keys()].filter((s) => !s.startsWith("node:"));
    for (const specifier of outside)
      expect(specifier.startsWith("ajv"), specifier).toBe(true);
  });

  it("the walk actually reads imports, and comments do not fool it", () => {
    expect(specifiersOf('import { x } from "node:fs";')).toEqual(["node:fs"]);
    expect(specifiersOf('/* a sentence about "node:fs" */ import { y } from "./a.js";')).toEqual(["./a.js"]);
    expect(specifiersOf('// from "node:path"\nimport "./b.js";')).toEqual(["./b.js"]);
    expect(specifiersOf('const z = require("node:zlib");')).toEqual(["node:zlib"]);
  });
});
