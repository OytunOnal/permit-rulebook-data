import { inflateSync } from "node:zlib";
import { normalize } from "./normalize.js";

/**
 * Reading the text layer out of a PDF, so a quote in a PDF is checked the way
 * a quote on a web page is.
 *
 * Two of the dataset's sources are PDFs. Until this slice the watch hashed
 * their bytes and stopped: a re-typeset PDF with the same words read as
 * `changed`, and — far worse — six quotes stood on the "pdf tier", reported as
 * unverifiable forever because nothing here could open the document. The
 * promise the product makes is "this sentence is on that page"; for a PDF it
 * was "somebody read it once".
 *
 * The documents in question embed subsetted TrueType fonts and address them by
 * GLYPH ID, not by character: the content stream says `<0026003a…> Tj`, and
 * `0x26` means whatever the embedded font's `cmap` says it means. So the only
 * way to the words is through the font, which is what this module does:
 * inflate every stream, keep the ones that are TrueType fonts, read their
 * `cmap` into a glyph→character map, and run the hex strings of every text
 * operator back through it.
 *
 * What it deliberately does NOT do is guess. A document with no embedded font
 * and no text operators — a scan — yields `null`, and the watch reports it as
 * having no text layer. Inventing words for a picture would put a machine's
 * reading of a photograph behind a sentence a person is told is quoted.
 */

/** TrueType/OpenType sfnt version numbers we accept as "this is a font". */
const SFNT_TRUETYPE = 0x00010000;
const SFNT_TRUE = 0x74727565; // "true"

/** One embedded font, by the order it was found in the file. */
export interface EmbeddedFont {
  /** 1-based position in the file — the only name a subsetted font reliably has. */
  index: number;
  /** glyph id → the character its own cmap claims it draws. */
  glyphs: Map<number, string>;
}

export interface PdfText {
  /** The decoded, normalised text layer. */
  text: string;
  fonts: EmbeddedFont[];
}

interface RawStream {
  /** The tail of the dictionary that introduced it — enough to say what it is. */
  dict: string;
  data: Uint8Array;
}

/** Every `stream …endstream` payload in the file, inflated where it says it is. */
function streams(bytes: Uint8Array): RawStream[] {
  const out: RawStream[] = [];
  // Latin-1 keeps byte offsets and string offsets identical, which is what
  // makes it safe to search a binary file as text.
  const text = Buffer.from(bytes).toString("latin1");
  let at = 0;
  for (;;) {
    const kw = text.indexOf("stream", at);
    if (kw < 0) break;
    at = kw + 6;
    // "endstream" also contains "stream"; skip the tail of one.
    if (text.slice(kw - 3, kw) === "end") continue;
    let start = at;
    if (text[start] === "\r") start++;
    if (text[start] === "\n") start++;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    const dict = text.slice(Math.max(0, kw - 900), kw);
    const raw = bytes.subarray(start, end);
    if (dict.includes("/FlateDecode")) {
      try {
        out.push({ dict, data: new Uint8Array(inflateSync(Buffer.from(raw))) });
      } catch {
        // A stream we cannot inflate is a stream we cannot read — it is not a
        // reason to abandon the rest of the document.
      }
    } else {
      out.push({ dict, data: new Uint8Array(raw) });
    }
    at = end + 9;
  }
  return out;
}

/**
 * Is this payload something other than page content?
 *
 * It matters because a content stream is read as text, and a JPEG or a font
 * binary read as text is a few megabytes of accidental parentheses and stray
 * `Tj`s. Anything the document itself declares to be an image, and anything
 * whose first bytes are a font's, is left alone.
 */
function isNotContent(s: RawStream): boolean {
  if (/\/Subtype\s*\/Image/.test(s.dict)) return true;
  if (s.data.length < 4) return true;
  const magic = Buffer.from(s.data.subarray(0, 4)).toString("latin1");
  return ["OTTO", "ttcf", "wOFF", "true", "%!PS"].includes(magic) || u32(s.data, 0) === SFNT_TRUETYPE;
}

const u16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const i16 = (b: Uint8Array, at: number): number => (u16(b, at) << 16) >> 16;

/** The `cmap` subtable formats these documents actually use. */
function readCmapSubtable(font: Uint8Array, at: number, into: Map<number, string>): void {
  const format = u16(font, at);
  if (format === 4) {
    const segX2 = u16(font, at + 6);
    const ends = at + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let s = 0; s < segX2; s += 2) {
      const end = u16(font, ends + s);
      const start = u16(font, starts + s);
      const delta = i16(font, deltas + s);
      const rangeOffset = u16(font, ranges + s);
      if (start > end) continue;
      for (let code = start; code <= end && code !== 0xffff; code++) {
        let glyph: number;
        if (rangeOffset === 0) glyph = (code + delta) & 0xffff;
        else {
          const gi = ranges + s + rangeOffset + (code - start) * 2;
          if (gi + 1 >= font.length) continue;
          glyph = u16(font, gi);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0 && !into.has(glyph)) into.set(glyph, String.fromCodePoint(code));
      }
    }
  } else if (format === 12) {
    const groups = u32(font, at + 12);
    for (let g = 0; g < groups; g++) {
      const rec = at + 16 + g * 12;
      if (rec + 12 > font.length) break;
      const startChar = u32(font, rec);
      const endChar = u32(font, rec + 4);
      const startGlyph = u32(font, rec + 8);
      for (let c = startChar; c <= endChar && c - startChar < 0x10000; c++) {
        const glyph = startGlyph + (c - startChar);
        if (glyph !== 0 && !into.has(glyph)) into.set(glyph, String.fromCodePoint(c));
      }
    }
  }
}

/** glyph id → character, for one embedded TrueType font. */
function fontGlyphs(font: Uint8Array): Map<number, string> | undefined {
  if (font.length < 12) return undefined;
  const version = u32(font, 0);
  if (version !== SFNT_TRUETYPE && version !== SFNT_TRUE) return undefined;
  const tables = u16(font, 4);
  let cmap = -1;
  for (let t = 0; t < tables; t++) {
    const rec = 12 + t * 16;
    if (rec + 16 > font.length) break;
    if (Buffer.from(font.subarray(rec, rec + 4)).toString("latin1") === "cmap") cmap = u32(font, rec + 8);
  }
  if (cmap < 0 || cmap + 4 > font.length) return undefined;
  const glyphs = new Map<number, string>();
  const subtables = u16(font, cmap + 2);
  for (let s = 0; s < subtables; s++) {
    const rec = cmap + 4 + s * 8;
    if (rec + 8 > font.length) break;
    const at = cmap + u32(font, rec + 4);
    if (at + 4 <= font.length) readCmapSubtable(font, at, glyphs);
  }
  return glyphs.size > 0 ? glyphs : undefined;
}

/**
 * The code points WinAnsi gives the bytes 0x80-0x9F, where Latin-1 keeps
 * control codes. Getting this row wrong is what turns the Chancenkarte's
 * quotation marks into two invisible characters. A `0` is a byte WinAnsi
 * leaves undefined; it keeps its own value rather than vanishing.
 */
const WIN_ANSI_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

const ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\",
};

/**
 * One literal string, unescaped. `\(` is a parenthesis, not a backslash and a
 * parenthesis — the difference decides whether the Chancenkarte's "(jeweils im
 * Ausbildungsstaat staatlich anerkannt)" can be found in the document at all.
 */
function literalString(content: string, from: number): { text: string; next: number } {
  let out = "";
  let depth = 1;
  let i = from;
  for (; i < content.length; i++) {
    const c = content[i];
    if (c === "\\") {
      const e = content[++i];
      if (e === undefined) break;
      if (e >= "0" && e <= "7") {
        let oct = e;
        while (oct.length < 3 && content[i + 1] >= "0" && content[i + 1] <= "7") oct += content[++i];
        out += charOf(parseInt(oct, 8));
      } else if (e === "\n") {
        // A line continuation inside a string contributes nothing.
      } else if (e === "\r") {
        if (content[i + 1] === "\n") i++;
      } else out += ESCAPES[e] ?? e;
    } else if (c === "(") {
      depth++;
      out += c;
    } else if (c === ")") {
      if (--depth === 0) break;
      out += c;
    } else out += charOf(c.charCodeAt(0));
  }
  return { text: out, next: i };
}

const charOf = (byte: number): string =>
  String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_HIGH[byte - 0x80] || byte : byte);

/**
 * The text each showing operator draws, in document order, one entry per
 * operator. The entry boundary is why the output has spaces at all: a PDF
 * positions words, it does not separate them.
 *
 * Both string forms are read. A hex string addresses the embedded font by
 * GLYPH ID and only the font can say what it draws (`glyphs`); a literal
 * string carries WinAnsi character codes and says so itself. The Spanish
 * ministry uses the first, the German consulate the second, and a decoder that
 * knew only one of them would report the other as having no text layer.
 *
 * Scanned rather than matched with a regular expression: a content stream is
 * megabytes of arbitrary bytes, and the obvious pattern for "the operands of a
 * `TJ`" backtracks catastrophically on the first stream that has none.
 */
function textRuns(content: string, glyphs: Map<number, string>): string[] {
  const runs: string[] = [];
  let pending = "";
  const flush = () => {
    if (pending.length > 0) runs.push(pending);
    pending = "";
  };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "(") {
      const { text, next } = literalString(content, i + 1);
      pending += text;
      i = next;
    } else if (c === "<" && content[i + 1] !== "<") {
      const end = content.indexOf(">", i + 1);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9A-Fa-f]/g, "");
      for (let h = 0; h + 4 <= hex.length; h += 4)
        pending += glyphs.get(parseInt(hex.slice(h, h + 4), 16)) ?? "";
      i = end;
    } else if (c === "T" && (content[i + 1] === "j" || content[i + 1] === "J")) {
      flush();
      i++;
    } else if ((c === "B" || c === "E") && content[i + 1] === "T") {
      flush();
      i++;
    }
  }
  flush();
  return runs;
}

/**
 * The document's text layer, or `null` where it has none.
 *
 * The glyph maps of every embedded font are MERGED, first font wins. That is
 * the compromise the decoder makes and the reason it can be wrong: a subsetted
 * font numbers its glyphs from scratch, so two fonts in one document routinely
 * disagree about what glyph 39 draws, and the first one asked decides. On the
 * Spanish ministry's PDF this costs exactly two letters — see
 * `KNOWN_GLYPH_SUBSTITUTIONS`. The alternative, resolving `/Tf` back through
 * the page's resource dictionary to the right font, needs a full object parser
 * and is the honest fix when a third PDF joins the watchlist. Until then the
 * substitution is written down, tested, and tolerated by name — never patched
 * out of the text, because a decoder that silently corrects itself cannot be
 * audited by the person holding the PDF.
 */
export function pdfToText(bytes: Uint8Array): PdfText | null {
  const fonts: EmbeddedFont[] = [];
  const merged = new Map<number, string>();
  const contents: string[] = [];
  for (const stream of streams(bytes)) {
    const glyphs = fontGlyphs(stream.data);
    if (glyphs) {
      fonts.push({ index: fonts.length + 1, glyphs });
      for (const [id, ch] of glyphs) if (!merged.has(id)) merged.set(id, ch);
    } else if (!isNotContent(stream)) {
      contents.push(Buffer.from(stream.data).toString("latin1"));
    }
  }

  const runs: string[] = [];
  for (const content of contents) runs.push(...textRuns(content, merged));
  const text = normalize(runs.join(" "));
  // No text layer is a real answer, and the only honest one for a scan.
  return text.length === 0 ? null : { text, fonts };
}

/**
 * Where a decoded document is known to disagree with the document a person
 * holds, and by exactly how much.
 *
 * Keyed by watch entry id. Each pair is `[what the decoder produces, what the
 * page says]`, and the quote check may substitute one for the other in the
 * DECODED text before comparing — never the other way round, and never in what
 * the dataset ships. Both readings are on the record: the quote is the
 * document's, the artefact is ours.
 */
export const KNOWN_GLYPH_SUBSTITUTIONS: Record<string, [string, string][]> = {
  // The ministry's threshold sheet sets its headings in a second subsetted
  // font whose glyph numbering collides with the body font's. Two capitals
  // land wrong: "¿Ouándo se aplica" for "¿Cuándo se aplica", "PAO nacional"
  // for "PAC nacional" (read against the PDF by a person, 2026-09-07).
  "es-uge-umbral-pdf": [["Ouándo", "Cuándo"], ["PAO nacional", "PAC nacional"]],
};

/** The decoded text with a source's known artefacts read as what the page says. */
export function repairKnownGlyphs(entryId: string, text: string): string {
  let out = text;
  for (const [wrong, right] of KNOWN_GLYPH_SUBSTITUTIONS[entryId] ?? [])
    out = out.split(wrong).join(right);
  return out;
}
