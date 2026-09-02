/** Content normalization for change detection: formatting noise (whitespace,
 * encoding) must never flag a change, while any real character change in the
 * monitored text always must. Unknown entities are therefore kept literally —
 * mapping them all to one character would make distinct texts hash equal
 * (`&ge;` vs `&le;` inverted a threshold in review finding #3). */

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&nbsp;": " ", "&euro;": "€", "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü",
  "&Auml;": "Ä", "&Ouml;": "Ö", "&Uuml;": "Ü", "&szlig;": "ß",
};

/** Total function: an out-of-range or malformed code point keeps its literal
 * form instead of throwing (a single mangled entity must not kill the pass). */
function codePoint(n: number, literal: string): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : literal;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, n) => codePoint(Number(n), m))
    .replace(/&[a-zA-Z][a-zA-Z0-9]*;/g, (e) => ENTITIES[e] ?? e);
}

export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
