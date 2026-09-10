/** Content normalization for change detection: formatting noise (whitespace,
 * encoding) must never flag a change, while any real character change in the
 * monitored text always must. Unknown entities are therefore kept literally —
 * mapping them all to one character would make distinct texts hash equal
 * (`&ge;` vs `&le;` inverted a threshold in review finding #3). */

// CAUTION: watchlist slice markers are written against THIS map's output
// (e.g. buzer's "&sect; 107" stays literal because &sect; is unmapped).
// Adding a mapping here can invalidate a marker — the watch then reports
// "slice marker missing" (unreachable) until the watchlist is updated.
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

/**
 * An element a reader reaches only by hovering it, and its contents.
 *
 * service-public marks the definition popover beside a defined word with
 * `role="tooltip"`, and ships it holding the literal, unsubstituted placeholder
 * `: titleContent` — the site fills it from `data-definition` in the browser.
 * Stripping tags alone therefore read the eligibility list of the ICT card as
 * "Vous êtes étranger (sauf Européen : titleContent ou Algérien)", so the
 * authority's own sentence — the one that closes the permit to an Algerian
 * passport — could not be quoted verbatim and verified against its own page
 * (s8). The rule is ARIA's, not this site's: text a reader reaches by hovering
 * is not part of the sentence it sits inside.
 */
const TOOLTIP = /<([a-z][a-z0-9]*)\b[^>]*\brole=["']tooltip["'][^>]*>[\s\S]*?<\/\1>/gi;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(TOOLTIP, " ")
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
