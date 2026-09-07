import { inflateSync } from "node:zlib";
import { looksLikeFont } from "./sfnt.js";

/**
 * Walking a PDF's container: every `stream … endstream` payload in the file,
 * inflated where the file says it is, and the one judgement that walk has to
 * make — is this payload page content, or is it a picture, a font, or some
 * other binary that would read as gibberish?
 *
 * Split out of `pdf-text.ts` because container syntax is a different subject
 * from what a content stream means (review 2026-09-07).
 */

export interface RawStream {
  /** The tail of the dictionary that introduced it — enough to say what it is. */
  dict: string;
  data: Uint8Array;
}

/** Every `stream …endstream` payload in the file, inflated where it says it is. */
export function streams(bytes: Uint8Array): RawStream[] {
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
 * Is this payload page content — the operators that draw a page?
 *
 * It matters because content is read as text, and a JPEG or a font binary read
 * as text is a few megabytes of accidental parentheses and stray `Tj`s.
 * Anything the document itself declares to be an image, and anything whose
 * first bytes are a font's, is not content and is left alone.
 */
export function isPageContent(s: RawStream): boolean {
  if (/\/Subtype\s*\/Image/.test(s.dict)) return false;
  if (s.data.length < 4) return false;
  return !looksLikeFont(s.data);
}
