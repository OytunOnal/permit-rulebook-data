import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { pdfToText, WIN_ANSI_HIGH } from "../src/watch/pdf-text.js";
import { repairKnownGlyphs, unboundedReason, type GlyphSubstitution } from "../src/watch/corrections.js";
import { checkCoverage, checkQuotes, runWatch, sha256, type Watchlist, type WatchState } from "../src/watch/core.js";
import type { Dataset } from "../src/types.js";

const watchlist = JSON.parse(readFileSync(new URL("../watch/watchlist.json", import.meta.url), "utf8")) as Watchlist;
const entryOf = (id: string) => watchlist.entries.find((e) => e.id === id)!;

/**
 * Fixture PDFs, built here rather than checked in.
 *
 * A committed binary is a fixture nobody can read in a diff, and the two
 * properties this module has to hold — "a text layer is decoded through the
 * embedded font" and "no text layer is never verified" — are properties of
 * document STRUCTURE. Building the structure in code is the only way the test
 * says which byte made it pass.
 */

const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/**
 * A TrueType font whose only table is a `cmap`, mapping each character to the
 * glyph id at its position + 3. Real subsetted fonts renumber their glyphs
 * exactly like this, which is why a PDF's hex strings are unreadable without
 * the font.
 */
function trueTypeFont(chars: string): { font: Buffer; glyphOf: (c: string) => number } {
  const codes = [...chars].map((c) => c.codePointAt(0)!);
  const glyphOf = (c: string) => codes.indexOf(c.codePointAt(0)!) + 3;
  const segments = codes.map((code, i) => ({ start: code, end: code, delta: (i + 3 - code) & 0xffff }));
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segX2 = segments.length * 2;
  const sub = [
    ...be16(4), ...be16(16 + segX2 * 4), ...be16(0), ...be16(segX2), ...be16(0), ...be16(0), ...be16(0),
    ...segments.flatMap((s) => be16(s.end)), ...be16(0),
    ...segments.flatMap((s) => be16(s.start)),
    ...segments.flatMap((s) => be16(s.delta)),
    ...segments.flatMap(() => be16(0)),
  ];
  const cmap = [...be16(0), ...be16(1), ...be16(3), ...be16(1), ...be32(12), ...sub];
  const font = [
    ...be32(0x00010000), ...be16(1), ...be16(0), ...be16(0), ...be16(0),
    ...[..."cmap"].map((c) => c.charCodeAt(0)), ...be32(0), ...be32(28), ...be32(cmap.length),
    ...cmap,
  ];
  return { font: Buffer.from(font), glyphOf };
}

/** One `n 0 obj … endobj` with a deflated stream body. */
function object(n: number, dict: string, body: Buffer): Buffer {
  const data = deflateSync(body);
  return Buffer.concat([
    Buffer.from(`${n} 0 obj <<${dict}/Filter/FlateDecode/Length ${data.length}>>\nstream\n`),
    data,
    Buffer.from("\nendstream\nendobj\n"),
  ]);
}

/** A PDF that draws `words` with an embedded font, addressed by glyph id. */
function textLayerPdf(words: string[]): Uint8Array {
  const { font, glyphOf } = trueTypeFont([...new Set(words.join(""))].join(""));
  const show = words
    .map((w) => `BT /F1 12 Tf 72 720 Td <${[...w].map((c) => glyphOf(c).toString(16).padStart(4, "0")).join("")}> Tj ET\n`)
    .join("");
  return new Uint8Array(Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    object(1, "/Length1 " + font.length, font),
    object(2, "", Buffer.from(show, "latin1")),
    Buffer.from("%%EOF\n"),
  ]));
}

/** A PDF that is a picture of a page: one image, no font, no text operator. */
function imageOnlyPdf(): Uint8Array {
  return new Uint8Array(Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    object(1, "/Type/XObject/Subtype/Image/Width 8/Height 8/ColorSpace/DeviceGray/BitsPerComponent 8",
      Buffer.alloc(64, 0x7f)),
    object(2, "", Buffer.from("q 612 0 0 792 0 0 cm /Im1 Do Q\n", "latin1")),
    Buffer.from("%%EOF\n"),
  ]));
}

/** A PDF that draws `text` as a WinAnsi literal string — the other form. The
 * encoding table is the decoder's own (imported, not copied): two tables that
 * agree only by hand would let the same typo pass on both sides. */
function literalStringPdf(text: string): Uint8Array {
  const { font } = trueTypeFont("x");
  const bytes: number[] = [];
  for (const c of text) {
    if ("\\()".includes(c)) bytes.push(0x5c);
    const high = WIN_ANSI_HIGH.indexOf(c.charCodeAt(0));
    bytes.push(high >= 0 ? 0x80 + high : c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    object(1, "/Length1 " + font.length, font),
    object(2, "", Buffer.concat([
      Buffer.from("BT /F1 12 Tf 72 720 Td (", "latin1"),
      Buffer.from(bytes),
      Buffer.from(") Tj ET\n", "latin1"),
    ])),
    Buffer.from("%%EOF\n"),
  ]));
}

describe("pdf-text — a quote in a PDF is checked like a quote on a page", () => {
  it("decodes a text layer back through the font that draws it", () => {
    const decoded = pdfToText(textLayerPdf(["Umbral", "general:", "41.356,36"]));
    expect(decoded).not.toBeNull();
    expect(decoded!.text).toBe("Umbral general: 41.356,36");
    expect(decoded!.fonts).toHaveLength(1);
  });

  it("reads the other string form too — WinAnsi literals, escapes undone", () => {
    // `\(` is a parenthesis. The Chancenkarte's own quote ends in one, and a
    // decoder that leaves the backslash in cannot find its own source's words.
    const decoded = pdfToText(literalStringPdf("Berufsabschluss (jeweils staatlich anerkannt) „für“ 1.091 €"));
    expect(decoded!.text).toBe("Berufsabschluss (jeweils staatlich anerkannt) „für“ 1.091 €");
  });

  it("a document with no text layer decodes to nothing — never to invented words", () => {
    expect(pdfToText(imageOnlyPdf())).toBeNull();
  });

  it("a changed text layer is a changed text", () => {
    const before = pdfToText(textLayerPdf(["Umbral", "general:", "41.356,36"]))!;
    const after = pdfToText(textLayerPdf(["Umbral", "general:", "44.100,00"]))!;
    expect(after.text).not.toBe(before.text);
    expect(sha256(after.text)).not.toBe(sha256(before.text));
  });

  it("the same words re-typeset are the same text, whatever the bytes say", () => {
    // The point of the strategy: a ministry that re-exports its PDF moves
    // every byte and not one word, and that must not read as news.
    const a = textLayerPdf(["Umbral", "general:", "41.356,36"]);
    const b = new Uint8Array(Buffer.concat([Buffer.from(a), Buffer.from("\n% re-exported\n")]));
    expect(sha256(b)).not.toBe(sha256(a));
    expect(pdfToText(b)!.text).toBe(pdfToText(a)!.text);
  });

  it("the decoder's known artefacts are declared beside the source, not in the decoder", () => {
    // Merging every embedded font's glyph map is what makes the decoder small
    // enough to audit, and it is why two capitals land wrong on one Spanish
    // PDF. The record shows both readings, and it is DATA on the watch entry:
    // the decoder does not know this document exists.
    const subs = entryOf("es-uge-umbral-pdf").glyph_substitutions!;
    expect(subs.map((sub) => [sub.from, sub.to])).toContainEqual(["Ouándo", "Cuándo"]);
    for (const sub of subs) {
      expect(sub.checked_at, sub.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(sub.reason.length, sub.from).toBeGreaterThan(10);
    }
    expect(repairKnownGlyphs(subs, "¿Ouándo se aplica")).toBe("¿Cuándo se aplica");
    // Nothing is repaired for a source with no declared artefact.
    expect(entryOf("kairo-chancenkarte-merkblatt").glyph_substitutions).toBeUndefined();
    expect(repairKnownGlyphs(undefined, "¿Ouándo")).toBe("¿Ouándo");
  });

  it("a correction may swap a glyph run, never write a phrase", () => {
    // The bound is what keeps this from being a way to make a failing quote
    // pass: a correction of the same length, with no space in it, cannot add a
    // clause, drop a condition, or invent a sentence the document lacks.
    const dated = { reason: "Two subsetted fonts collide on this glyph.", checked_at: "2026-09-07" };
    const phrase: GlyphSubstitution = { from: "Umbral", to: "Umbral general: 41.356,36", ...dated };
    expect(unboundedReason(phrase)).toContain("length");
    expect(repairKnownGlyphs([phrase], "Umbral"), "a phrase substitution was applied").toBe("Umbral");

    expect(unboundedReason({ from: "PAO nacional", to: "PAC nacional", ...dated })).toContain("whitespace");
    expect(unboundedReason({ from: "PAO", to: "PAC", ...dated, checked_at: "7 September 2026" })).toContain("checked_at");
    expect(unboundedReason({ from: "PAO", to: "PAC", ...dated, reason: "typo" })).toContain("reason");
    expect(unboundedReason({ from: "PAO", to: "PAC", ...dated })).toBeNull();
  });

  it("and the coverage gate refuses a declared correction that is not one", () => {
    const dataset = { schema_version: "0.4.0", dataset_version: "t", fields: [], countries: [] } as unknown as Dataset;
    const loosened: Watchlist = {
      entries: [{
        ...entryOf("es-uge-umbral-pdf"),
        glyph_substitutions: [{
          from: "Umbral", to: "Umbral general: 41.356,36",
          reason: "It would be convenient if the sheet said this.", checked_at: "2026-09-07",
        }],
      }],
    };
    const result = checkCoverage(dataset, loosened);
    expect(result.ok).toBe(false);
    expect(result.unbounded_substitutions).toHaveLength(1);
    expect(result.unbounded_substitutions[0]).toContain("es-uge-umbral-pdf");
    // The shipped watchlist passes it.
    expect(checkCoverage(dataset, watchlist).unbounded_substitutions).toEqual([]);
  });
});

describe("pdf-text — the watch pass", () => {
  const entry = {
    id: "fixture-pdf", url: "https://example.test/f.pdf",
    strategy: "pdf-text" as const, kind: "value-source" as const,
  };
  const watchlist: Watchlist = { entries: [entry] };
  const fetcherFor = (body: Uint8Array) => async () => ({ ok: true as const, body });
  const empty: WatchState = { entries: {} };

  it("stores the words, and the file's own hash beside them", async () => {
    const pdf = textLayerPdf(["Umbral", "general:", "41.356,36"]);
    const { reports, nextState } = await runWatch(watchlist, empty, fetcherFor(pdf), "2026-09-07");
    expect(reports[0].outcome).toBe("baseline");
    const snapshot = nextState.entries["fixture-pdf"];
    expect(snapshot.text).toBe("Umbral general: 41.356,36");
    expect(snapshot.bytes_hash).toBe(sha256(pdf));
    expect(snapshot.hash).toBe(sha256(snapshot.text!));
  });

  it("reports unchanged when only the bytes moved, and changed when a word did", async () => {
    const pdf = textLayerPdf(["Umbral", "general:", "41.356,36"]);
    const { nextState } = await runWatch(watchlist, empty, fetcherFor(pdf), "2026-09-07");
    const reExported = new Uint8Array(Buffer.concat([Buffer.from(pdf), Buffer.from("\n% again\n")]));
    const same = await runWatch(watchlist, nextState, fetcherFor(reExported), "2026-09-08");
    expect(same.reports[0].outcome).toBe("unchanged");
    const moved = await runWatch(watchlist, nextState, fetcherFor(textLayerPdf(["Umbral", "general:", "44.100,00"])), "2026-09-08");
    expect(moved.reports[0].outcome).toBe("changed");
  });

  it("a scan is recorded as having no text layer, and keeps watching its bytes", async () => {
    const scan = imageOnlyPdf();
    const { reports, nextState } = await runWatch(watchlist, empty, fetcherFor(scan), "2026-09-07");
    expect(reports[0].outcome).toBe("baseline");
    const snapshot = nextState.entries["fixture-pdf"];
    expect(snapshot.text).toBeUndefined();
    // One word for the state, the dataset's own: a statement with no quote
    // because its source is a picture says `scanned-image` too.
    expect(snapshot.unverifiable_reason).toBe("scanned-image");
    // The bytes are still watched: a scan replaced by a real document is news.
    expect(snapshot.hash).toBe(sha256(scan));
  });
});

describe("s5f invariant — a PDF text strategy never reports verified for a document with no text layer", () => {
  /** A dataset that rests one quote on one PDF, so the gate has something to check. */
  const datasetQuoting = (quote: string): Dataset => ({
    schema_version: "0.4.0",
    dataset_version: "test",
    fields: [],
    countries: [{
      code: "XX",
      name: "Testland",
      routes: [{
        id: "r", name: "Route", kind: "res-work", info_url: "https://example.test/",
        scope: { value: "every-deciding-rule-asked" as const, not_asked: [], reason: "Every rule this route turns on is asked." },
        criteria: [{ field: "f", op: "eq", value: "v", source: { source_url: "https://example.test/f.pdf", quote, retrieved_at: "2026-09-07" } }],
      }],
    }],
  });

  it("holds over 60 generated documents, with a text layer and without", { timeout: 60_000 }, async () => {
    const entry = { id: "gen", url: "https://example.test/f.pdf", strategy: "pdf-text" as const, kind: "value-source" as const };
    const watchlist: Watchlist = { entries: [entry] };
    const rand = (() => { let s = 4826 >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
    let scans = 0;
    let readable = 0;
    for (let i = 0; i < 60; i++) {
      const words = ["Umbral", `general:${i}`, "41.356,36"];
      const hasText = rand() < 0.5;
      const pdf = hasText ? textLayerPdf(words) : imageOnlyPdf();
      const { nextState } = await runWatch(watchlist, { entries: {} }, async () => ({ ok: true, body: pdf }), "2026-09-07");
      // The quote is the one the readable document really carries, so the only
      // thing separating the two cases is whether the document has words.
      const result = checkQuotes(datasetQuoting(words.join(" ")), watchlist, nextState);
      if (hasText) {
        readable++;
        expect(result.verified, `document ${i} has a text layer`).toBe(1);
      } else {
        scans++;
        expect(result.verified, `document ${i} is a scan and was counted verified`).toBe(0);
        expect(result.unverifiable).toHaveLength(1);
        expect(result.unverifiable[0].reason).toContain("scanned-image");
        expect(result.unverifiable[0].reason).toContain("no text layer");
      }
    }
    // A property that never met a scan would prove nothing.
    expect(scans).toBeGreaterThan(10);
    expect(readable).toBeGreaterThan(10);
  });
});
