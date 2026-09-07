import { normalize } from "./normalize.js";
import { isPageContent, streams } from "./pdf-objects.js";
import { fontGlyphs, type EmbeddedFont } from "./sfnt.js";

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
 * This module decodes CONTENT STREAMS: the two string forms a showing operator
 * takes, and where one run of text ends and the next begins. Walking the
 * container is `pdf-objects.ts`, reading the embedded fonts is `sfnt.ts`, and
 * the corrections a decoded document needs are `corrections.ts` — four
 * subjects that change for four different reasons (review 2026-09-07).
 *
 * What it deliberately does NOT do is guess. A document with no embedded font
 * and no text operators — a scan — yields `null`, and the watch reports it as
 * a scanned image. Inventing words for a picture would put a machine's reading
 * of a photograph behind a sentence a person is told is quoted.
 */

export type { EmbeddedFont } from "./sfnt.js";

export interface PdfText {
  /** The decoded, normalised text layer. */
  text: string;
  fonts: EmbeddedFont[];
}

/**
 * The code points WinAnsi gives the bytes 0x80-0x9F, where Latin-1 keeps
 * control codes. Getting this row wrong is what turns the Chancenkarte's
 * quotation marks into two invisible characters. A `0` is a byte WinAnsi
 * leaves undefined; it keeps its own value rather than vanishing.
 *
 * Exported so the test that builds a WinAnsi fixture encodes with the table
 * the decoder decodes with, rather than a second copy that can drift from it.
 */
export const WIN_ANSI_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

const ESCAPES: Record<string, string> = {
  n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\",
};

const charOf = (byte: number): string =>
  String.fromCharCode(byte >= 0x80 && byte <= 0x9f ? WIN_ANSI_HIGH[byte - 0x80] || byte : byte);

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
 * disagree about what glyph 39 draws, and the first one asked decides. Where
 * that costs a letter, the watchlist entry for the source declares the
 * confusion by name (`corrections.ts`). The alternative, resolving `/Tf` back
 * through the page's resource dictionary to the right font, needs a full
 * object parser and is the honest fix when a third PDF joins the watchlist.
 * Until then the artefact is written down, dated, bounded and tolerated —
 * never patched out of the text, because a decoder that silently corrects
 * itself cannot be audited by the person holding the PDF.
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
    } else if (isPageContent(stream)) {
      contents.push(Buffer.from(stream.data).toString("latin1"));
    }
  }

  const runs: string[] = [];
  for (const content of contents) runs.push(...textRuns(content, merged));
  const text = normalize(runs.join(" "));
  // No text layer is a real answer, and the only honest one for a scan.
  return text.length === 0 ? null : { text, fonts };
}
