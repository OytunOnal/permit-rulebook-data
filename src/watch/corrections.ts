/**
 * Where a decoded document is known to disagree with the document a person
 * holds, and by exactly how much.
 *
 * The decoder merges every embedded font's glyph map, first font wins, and a
 * subsetted font renumbers its glyphs from scratch — so two fonts in one
 * document routinely disagree about what glyph 39 draws. On one PDF this costs
 * exactly two capitals. The correction is applied to the DECODED text for the
 * quote comparison only, never to anything the dataset ships.
 *
 * It lived as a TypeScript constant with its justification in a code comment,
 * which made "add a pair here and the failing quote verifies" a one-line edit
 * nothing could question. It is a declared decision now, in the watchlist
 * beside the source it corrects: each correction says WHY and WHEN a person
 * read it against the document, and is bounded so it can only ever be a
 * confusion between two glyph runs — never a phrase that writes content
 * (review 2026-09-07, S3).
 */

export interface GlyphSubstitution {
  /** The run the decoder produces. */
  from: string;
  /** The run the page actually shows. */
  to: string;
  /** Which glyphs collide and how it was established — prose, for a reader. */
  reason: string;
  /** The day a person read this against the document, in `retrieved_at`'s shape. */
  checked_at: string;
}

const DATED = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why a declared correction is not one, or `null` when it is sound.
 *
 * The bound is the whole point: same length, no whitespace, and actually
 * different. A correction that may only swap one glyph run for another of the
 * same length cannot insert a clause, cannot delete a condition, and cannot
 * turn a sentence the document does not contain into one it does.
 */
export function unboundedReason(sub: GlyphSubstitution): string | null {
  if (sub.from.length === 0 || sub.to.length === 0) return "empty run";
  if (sub.from.length !== sub.to.length)
    return `runs differ in length (${sub.from.length} vs ${sub.to.length}) — a correction may not add or remove characters`;
  if (/\s/.test(sub.from) || /\s/.test(sub.to))
    return "a run may not contain whitespace — a confusion is between glyphs, never across a phrase";
  if (sub.from === sub.to) return "the two runs are identical";
  if (!DATED.test(sub.checked_at)) return `checked_at is not a date in YYYY-MM-DD (${sub.checked_at})`;
  if (sub.reason.trim().length < 10) return "no reason given for the correction";
  return null;
}

/**
 * The decoded text with a source's declared artefacts read as what the page
 * says. A correction that fails its bound is skipped, not applied — so a
 * malformed entry can never be what makes a quote verify. The coverage gate
 * reports it separately, and loudly.
 */
export function repairKnownGlyphs(subs: GlyphSubstitution[] | undefined, text: string): string {
  let out = text;
  for (const sub of subs ?? [])
    if (unboundedReason(sub) === null) out = out.split(sub.from).join(sub.to);
  return out;
}
