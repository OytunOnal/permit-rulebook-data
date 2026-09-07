/**
 * Reading an embedded TrueType/OpenType font far enough to answer one
 * question: which character does glyph N draw?
 *
 * A PDF that addresses its font by GLYPH ID (`<0026003a…> Tj`) is unreadable
 * without this: `0x26` means whatever the embedded font's `cmap` says it
 * means, and a subsetted font renumbers its glyphs from scratch. Split out of
 * `pdf-text.ts` because font formats and PDF container syntax change for
 * entirely different reasons (review 2026-09-07).
 */

/** TrueType/OpenType sfnt version numbers we accept as "this is a font". */
const SFNT_TRUETYPE = 0x00010000;
const SFNT_TRUE = 0x74727565; // "true"

/** Magic numbers of the font containers we do NOT parse but must recognise,
 * so a font binary is never read as page content. */
const FONT_MAGICS = ["OTTO", "ttcf", "wOFF", "true"];

export const u16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];
export const u32 = (b: Uint8Array, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const i16 = (b: Uint8Array, at: number): number => (u16(b, at) << 16) >> 16;

/** One embedded font, by the order it was found in the file. */
export interface EmbeddedFont {
  /** 1-based position in the file — the only name a subsetted font reliably has. */
  index: number;
  /** glyph id → the character its own cmap claims it draws. */
  glyphs: Map<number, string>;
}

/**
 * Does this payload begin like a font container? Cheap, and deliberately
 * generous: the cost of a false positive is one stream not read as text, the
 * cost of a false negative is megabytes of font binary parsed as page content.
 */
export function looksLikeFont(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const magic = Buffer.from(data.subarray(0, 4)).toString("latin1");
  return FONT_MAGICS.includes(magic) || u32(data, 0) === SFNT_TRUETYPE;
}

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
export function fontGlyphs(font: Uint8Array): Map<number, string> | undefined {
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
