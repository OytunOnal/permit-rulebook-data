/**
 * What kind of failure a read was — the one word three decisions hang off.
 *
 * Until s35 every failure was the same word, `unreachable`, and the watch
 * could not tell a hiccup from an outage: four of the five runs before
 * 2026-09-24 were red and none of them for a reason that was still there the
 * next morning — six `HTTP 403`s that read clean the following day, three
 * `TypeError: fetch failed` whose cause was never printed.
 *
 * It lives in a file of its own because BOTH readers answer it and neither
 * owns it: the fetcher classes a status and a socket error, the browser tier
 * classes a step that found no field and a navigation it refused, and the
 * rule that says which is which must be one rule. `core.ts` would make the
 * browser files import the engine to throw a failure.
 *
 * **Where a failure's text ends up, and why every bound in here exists.** An
 * error travels into a log line, into a flag file, and into the issue that
 * flag becomes — three places a person reads and a fourth nobody controls.
 * So what goes into one is what this watch decided, never what a source or a
 * socket wrote: the kind of an address and not the address, a cause's code
 * and not its message, a page's own words bounded. Every printer in this
 * package answers to that sentence, and points here rather than repeating it.
 *
 * **The one exemption, and the half it never covered.** A `ReadFailure` the
 * browser tier throws is not cut: the step diagnosis runs to five hundred
 * characters on purpose, and is the whole of what a curator acts on instead
 * of spending another dispatch (`browser.ts`). That exemption is about
 * LENGTH, and it is granted because the SENTENCE is ours. It was never an
 * exemption from content, because part of that sentence is not ours: it
 * QUOTES the page — an option label, an element's role — and a quotation
 * belongs to whoever wrote it, whatever sentence it sits in. So a
 * page-written fragment is made printable and bounded where it is built,
 * before it reaches a sentence of ours: `printableWithin` holds both halves,
 * `MOST_OF_A_PAGE_WORD` is how much of one fragment a sentence may carry, and
 * `PRINTABLE_WITHIN_SOURCE` is the same rule for the half of `steps.ts` that
 * runs inside Chrome. The exemption then covers our own words and nothing
 * else (Security review, 2026-09-24).
 */

/**
 * - **transient** — nothing about the source says no; the reading simply did
 *   not happen. A network error, the budget spent, the source asking for a
 *   moment (408, 425, 429), the source calling it its own fault (5xx), an
 *   empty body. Worth one more try in the same run.
 * - **refused-by-source** — the source answered, and the answer was no or was
 *   not the page. Any other 4xx, a bot wall, a page that moved; a browser step
 *   that finds no field, because the page changed. The same answer comes back
 *   in three minutes, so it is not asked again.
 * - **refused-by-us** — the floor declined to make the request at all: a
 *   credentialled or malformed address, an off-origin redirect or navigation,
 *   a private or loopback target, too many hops, no Chrome on this machine.
 *   Our environment, not the source's minute — so it is neither retried nor
 *   given a day of grace.
 */
export type FailureClass = "transient" | "refused-by-source" | "refused-by-us";

/**
 * A failure that knows its own class, thrown where the fact is known.
 *
 * The browser tier's failures happen several layers down — a step that finds
 * no field in `steps.ts`, a navigation off the origin in `cdp.ts` — and come
 * back to the reader as a throw. Carrying the class on the error is what
 * stops the reader guessing it from the wording afterwards, which is the
 * fault this file exists to avoid: a class read off a sentence changes the
 * day a curator is called the moment somebody edits the sentence.
 */
export class ReadFailure extends Error {
  readonly failure: FailureClass;
  constructor(message: string, failure: FailureClass) {
    super(message);
    this.name = "ReadFailure";
    this.failure = failure;
  }
}

/**
 * Characters that steer a reader rather than say anything to one.
 *
 * They are here because a curator reads this sentence in a terminal and in a
 * Markdown body, and both act on them: a right-to-left override makes the
 * rest of a line read backwards, which is how a sentence can name one address
 * and display another.
 *
 * Dropped rather than collapsed, because they have no width: putting a space
 * where one stood would break a word the source did not break. That is also
 * why this class runs BEFORE `UNPRINTED_CLASS` below, which collapses — a
 * character with no width belongs to the rule that drops.
 *
 * Written as the SOURCE of a class rather than as a literal, because the
 * page-side half of the step vocabulary runs this same rule inside Chrome and
 * cannot call in here (`PRINTABLE_WITHIN_SOURCE`). One spelling of which
 * characters steer, two runtimes that obey it. The `u` flag travels with it
 * everywhere the source is used: `\p{…}` means a Unicode property only under
 * `u`, and without the flag it quietly means the letter `p` instead.
 *
 * **The rule, so the next reader can check it rather than trust it.** The
 * class is Unicode's own `Default_Ignorable_Code_Point` property and nothing
 * else: everything that prints nothing. It is asked of the engine rather than
 * typed out, so a reader checks any character by asking the same question the
 * code asks — `/\p{Default_Ignorable_Code_Point}/u.test(c)` — and there is no
 * enumeration here that can be short. Unicode derives it in
 * `DerivedCoreProperties.txt`, and the derivation is worth having in the eye:
 * `Other_Default_Ignorable_Code_Point` plus the format characters (`Cf`) plus
 * the variation selectors, less the ones that are whitespace, less the
 * three interlinear annotation characters (U+FFF9–U+FFFB) and the thirteen
 * prepended concatenation marks — the ones Unicode says do print (counted
 * on this Node, v24.20.0, 2026-09-25: three and thirteen, and the property
 * holds 4,174 code points in all).
 *
 * **Why the rule is the superset and not the two families it was written
 * for.** It was spelled as Unicode's twelve `Bidi_Control` code points and
 * the invisible joiners, and a hand-listed set is only as good as its
 * author's eye. U+061C ARABIC LETTER MARK sat outside the ranges it was
 * written with and travelled whole into all three places a failure is printed
 * (Security review, 2026-09-24). A round later the same reading found more
 * the list could not have caught, because they are in neither family: the
 * soft hyphen (U+00AD), the Mongolian vowel separator (U+180E), the four
 * Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), the combining grapheme
 * joiner (U+034F) and the Khmer inherent vowels (U+17B4, U+17B5) print
 * nothing — the last three are not even format characters, which is the
 * shape of the fault: a hand-listed set is a guess at a property. `\s`
 * does not match a soft hyphen and the control ranges below do not reach one
 * — so two labels that are not the same string rendered alike in a sentence
 * a curator reads (Security review, 2026-09-25). The names stay: a character
 * that prints nothing cannot say anything to a reader, so whatever it does it
 * does to how the rest is read. The bidi embeddings, overrides and isolates
 * are the sharp members of that set, not the whole of it.
 *
 * **What the property takes that the two families did not, named so it is a
 * known edge and not an oversight.** U+FEFF, which `\s` also matches — it is
 * dropped here rather than collapsed there, which is the right of the two
 * answers for a character with no width, and one rule for it instead of two.
 * U+2065, which is unassigned. The variation selectors (U+FE00–U+FE0F) and
 * tag characters (U+E0020–U+E007F), which ride on the character before them:
 * a variation selector's loss changes how an emoji is drawn, a tag
 * sequence's loss takes text a reader never sees. None of them is a fact
 * about a source worth carrying into a log line.
 */
const STEERING_CHARACTERS = "\\p{Default_Ignorable_Code_Point}";
const STEERING_CLASS = `[${STEERING_CHARACTERS}]`;
const STEERING = new RegExp(STEERING_CLASS, "gu");

/**
 * Does this text still carry one? The rule, for whoever asks about a string.
 *
 * Exported because the class had one spelling here and three more in the
 * tests that prove sentences are free of it, and a test that retypes a rule
 * passes while the rule is wrong (Standards review, 2026-09-24). A test names
 * this; nobody retypes the rule.
 */
export function hasSteering(text: string): boolean {
  return new RegExp(STEERING_CLASS, "u").test(text);
}

/**
 * Runs of anything that is not a printed character.
 *
 * Whitespace (`\s`, which carries `\n`, `\r`, `\t` and the space's Unicode
 * cousins) and the control bytes no `\s` covers: C0 (` `–``,
 * including the `` a terminal reads as the start of an escape
 * sequence), DEL, and the C1 range (``–``, including the ``
 * that is a one-byte CSI).
 *
 * Collapsed to ONE SPACE rather than dropped: a newline between two words is
 * the gap between them, and closing it would join two words the source did
 * not join. What is left of an escape sequence — its `[31m`, say — is inert
 * text once the `` that introduced it is gone; this rule keeps the
 * source's punctuation and takes only what is acted on.
 *
 * A class source, for the same reason as `STEERING_CLASS` above. The control
 * ranges are named once, because a test asks about them too (`hasControl`)
 * and the whitespace half is not what a test may forbid: a sentence has
 * spaces in it on purpose.
 */
const CONTROL_CHARACTERS = "\\u0000-\\u001f\\u007f-\\u009f";
const UNPRINTED_CLASS = `[\\s${CONTROL_CHARACTERS}]+`;
const UNPRINTED = new RegExp(UNPRINTED_CLASS, "g");

/** Does this text still carry a byte a terminal acts on? One spelling, as above. */
export function hasControl(text: string): boolean {
  return new RegExp(`[${CONTROL_CHARACTERS}]`).test(text);
}

/**
 * The same words, on one line a terminal and a Markdown body only print.
 *
 * The log line was never the exposure: it is a JSON field, and JSON escapes
 * a newline. The flag file and the issue that flag becomes are — the issue
 * is Markdown, where a newline ends the paragraph and everything the source
 * wrote after it is loose in the page (Security review, 2026-09-24).
 */
function printable(text: string): string {
  return text.replace(STEERING, "").replace(UNPRINTED, " ").trim();
}

/**
 * As much of a SOURCE's own words as belongs in a failure a person reads.
 *
 * The browser tier throws a page's own exception `description` — the page's
 * string, its stack included, and the stack names the page — and that becomes
 * the failure a run logs. A page can make it as long as it likes: measured
 * 2026-09-24 at 10,104 characters carrying the page's origin. The fetcher
 * already binds every address it prints at 200 for the same reason
 * (`MOST_OF_AN_ADDRESS`). This was one of the two printed strings the slice
 * left with no bound at all; the other is a cause's `code`, bound by
 * `A_CODE` below (Security review, 2026-09-24).
 *
 * The bound is TOTAL, unlike the address's, because this is the whole of what
 * a line says about a failure rather than one field inside it.
 *
 * **Length was never the whole rule.** Two hundred characters of somebody
 * else's string still carried whatever bytes were inside them into the flag
 * file and the issue, which is what `printable` above now takes out. One
 * owner, because it is one rule: a thrown thing's words are cut AND made
 * printable, in one place, and both call sites — the fetcher's throw and the
 * browser tier's — ask for it by asking here (Security review, 2026-09-24).
 *
 * It is NOT applied to every `ReadFailure`. Most of them are OURS — the step
 * diagnosis that names what the page offered instead of the option asked for
 * runs to five hundred characters on purpose, and is the whole reason a
 * curator can act on it. The bound belongs where a string arrives from the
 * source, which is at the throw. What that exemption does NOT reach is the
 * page's own words inside such a sentence: those are bounded by
 * `MOST_OF_A_PAGE_WORD`, where they are quoted.
 */
export const MOST_OF_A_FAILURE = 200;

/**
 * As much of ONE thing the page wrote as a sentence of ours may quote.
 *
 * A step diagnosis is ours and runs long, but it quotes the page several
 * times over — the label of every option offered, the tag, type and role of
 * every control it met, the value the field ended up holding. Each quotation
 * is as long as the page cares to make it: measured 2026-09-24 through a real
 * Chrome, one `role` attribute put ten thousand characters, a newline and a
 * right-to-left override into the middle of our sentence.
 *
 * Forty because that is the bound this package has printed an option's text
 * at since s34, when the diagnosis was written: the seven pages it reads name
 * countries and permits, and forty characters holds those with room over. A
 * fragment longer than that says its own length instead, which is the fact a
 * curator needs about it.
 */
export const MOST_OF_A_PAGE_WORD = 40;

/**
 * Printable, and inside a bound: the two halves of what may be printed.
 *
 * It was called `shortFailure` while the length was the only half anybody
 * asked for, and it kept the name after the printable rule moved inside it —
 * so two call sites read it as a bound and one of the two things it does had
 * no name at all (Standards review, 2026-09-24). Both halves are in the name
 * now, and the bound is the caller's word rather than this function's: what
 * `MOST_OF_A_FAILURE` holds is a whole sentence, what `MOST_OF_A_PAGE_WORD`
 * holds is one quotation inside one, and neither is the other's business.
 *
 * The cut is made on the printable sentence, so the count the note prints is
 * the length of what was cut rather than of a string nobody ever sees.
 *
 * **The unit is a character, everywhere in here.** `most`, the count the note
 * prints and the place the cut falls are all Unicode code points — what a
 * person counts when they read "200 characters" — and not the UTF-16 units a
 * runtime stores them in. It was units until 2026-09-24, and that is two
 * faults in one line: the note said "10,104 characters" of a string with
 * 5,052 characters in it, and `slice` could end between the halves of an
 * astral character and emit a lone surrogate — a string that is not valid
 * UTF-8 at all, which a JSON line escapes as a bare `\udXXX` and a Markdown
 * body renders as a replacement character (Security review, 2026-09-24).
 *
 * What that costs: a sentence of astral characters is still at most `most`
 * characters, which is at most four times `most` bytes. The bound exists so a
 * page cannot decide how long a log line is, and a page that spends its 200
 * characters on emoji has decided nothing a person cannot read.
 *
 * **A bound smaller than the note is still a bound.** The room left for the
 * text is `most` less the note's own length, and nothing says a caller's
 * bound must exceed the note, whose own length moves with the count it
 * carries. Below that, the subtraction goes negative, and a negative second
 * argument makes `slice` count from the END and keep nearly the whole string
 * — the bound voided exactly where it is tightest. No caller asks for one that small today, which is why it was
 * never seen and not a reason it is safe: a bound is a promise about the
 * output, not about the callers there happen to be. Where the note does not
 * fit, the note is what goes — the answer is the first `most` characters and
 * no note, because a sentence that cannot say how long the whole was is
 * better than one that is not bounded at all (Security review, 2026-09-25).
 */
export function printableWithin(text: string, most: number): string {
  const said = printable(text);
  const characters = [...said];
  if (characters.length <= most) return said;
  const note = noteOfLength(characters.length);
  const room = most - note.length;
  if (room < 0) return characters.slice(0, Math.max(0, most)).join("");
  return `${characters.slice(0, room).join("")}${note}`;
}

/**
 * What a cut says about itself: how long the whole sentence was.
 *
 * The same shape `shortAddress` prints for an address it shortened
 * (`fetch-source.ts`) — the length of the WHOLE, not of what was dropped, so
 * a curator reads one spelling wherever this package shortens something. It
 * is a function because there are two runtimes to say it in and it was hand
 * copied into both, which is how two copies start disagreeing about what a
 * cut sentence claims (Standards review, 2026-09-24).
 *
 * Exported for the reason `hasSteering` is: the wording had a second copy in
 * `shortAddress` and two more in the tests that assert what a cut sentence
 * claims, and a test that retypes a rule passes while the rule is wrong. The
 * callers and the tests name this; nobody retypes the words or the unit
 * (Standards review, 2026-09-25).
 */
export function noteOfLength(characters: number): string {
  return `… (${characters} characters)`;
}

/**
 * The same note, as the two halves a page-side spelling splices a count into.
 *
 * Built by asking `noteOfLength` for a note about zero and cutting the answer
 * where the count stood, so the sentence exists once in this file and the
 * page's copy cannot drift from it.
 */
export const [NOTE_BEFORE, NOTE_AFTER] = noteOfLength(0).split("0") as [string, string];

/**
 * The same rule, as source, for the one reader that cannot call it.
 *
 * Half of the step vocabulary runs inside Chrome — it is serialized into
 * `Runtime.evaluate`, and a page's words are quoted there, where the sentence
 * that quotes them is built (`steps.ts`). That half cannot import this file,
 * and a second hand-written copy of the rule is how two copies start
 * disagreeing about which characters steer. So the rule is handed over as
 * text, built from the same two class sources this file's own `printable`
 * uses, and from the same note (`NOTE_BEFORE`/`NOTE_AFTER`): one spelling of
 * every piece, two runtimes.
 *
 * What is still typed twice is the arithmetic between those pieces — the cut
 * on characters, the room left for the note and what is printed when there is
 * no room for one — because a page cannot import a function. It is not left to the eye: `tests/s36.test.ts` runs this source
 * and `printableWithin` over the same table and fails if they answer
 * differently about a sentence, a page's word, an astral character or a
 * boundary (Standards review, 2026-09-24).
 *
 * No backtick and no `${` in here: the page script it is spliced into is a
 * template literal, and either one would end it.
 */
export const PRINTABLE_WITHIN_SOURCE = [
  "function printableWithin(text, most) {",
  '    var said = String(text == null ? "" : text)',
  // `u` on the first and not the second: `\p{…}` means a Unicode property
  // only under that flag, and without it means the letter `p`. The control
  // ranges are ranges and ask for nothing.
  `      .replace(/${STEERING_CLASS}/gu, "").replace(/${UNPRINTED_CLASS}/g, " ").trim();`,
  // Characters, not UTF-16 units: a cut between the halves of an astral
  // character emits a lone surrogate into a sentence a person reads.
  "    var characters = Array.from(said);",
  "    if (characters.length <= most) return said;",
  `    var note = ${JSON.stringify(NOTE_BEFORE)} + characters.length + ${JSON.stringify(NOTE_AFTER)};`,
  // A bound smaller than the note would hand `slice` a negative second
  // argument, which counts from the end and keeps nearly the whole string.
  "    var room = most - note.length;",
  '    if (room < 0) return characters.slice(0, Math.max(0, most)).join("");',
  '    return characters.slice(0, room).join("") + note;',
  "  }",
].join("\n");

/**
 * What an HTTP status means about trying again — one rule, both readers.
 *
 * 408, 425 and 429 are the source asking for a moment and every 5xx is the
 * source calling it its own fault: all of them may answer differently three
 * minutes later. Every other 4xx is an answer that will not change — a bot
 * wall, a page that moved, a page that is gone — and asking a wall twice is
 * asking it to change its mind.
 *
 * A 3xx that got this far is a redirect that went nowhere usable, which is
 * the source's own broken answer and falls here with the rest.
 */
export function failureOfStatus(status: number): FailureClass {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "transient";
  return "refused-by-source";
}

/**
 * The cause's CODE, and never its message.
 *
 * Node wraps every socket failure as `TypeError: fetch failed`, which is the
 * same five words for a reset connection, a name that does not resolve and a
 * connect timeout — three of the runs this slice was written for say exactly
 * that and nothing else. The code underneath (`ECONNRESET`, `ENOTFOUND`,
 * `UND_ERR_CONNECT_TIMEOUT`) is what tells them apart.
 *
 * The MESSAGE is not taken: undici writes the address into it, and this
 * message is the text that travels into all three places this file opens by
 * naming — the log line, the flag file, and the issue that flag becomes.
 *
 * Neither is anything that is not shaped like a code. `cause.code` is a field
 * name, and a field name is not a promise: a thrower that is not Node can put
 * whatever it likes there — the second of the two printed strings the slice
 * left with no bound at all, beside a page's own words above
 * (`MOST_OF_A_FAILURE`; Security review, 2026-09-24). A code is Node's
 * and undici's own spelling — capitals, digits and underscores — and short;
 * anything else is something else wearing the name, and is simply not
 * printed, which costs a log line one parenthesis.
 *
 * `MOST_OF_A_CODE` is measured, not chosen. Against this repository's Node (v24.20.0,
 * 2026-09-24): undici ships twenty-four `UND_ERR_*` codes and the longest,
 * `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH`, is 35 characters; of the 134 errno
 * names `os.constants.errno` carries the longest is `WSAEPROVIDERFAILEDINIT`
 * at 22, and the longest of the 76 that are not Windows' own is
 * `EPROTONOSUPPORT` at 15. Forty is the round number above both, with five
 * characters of room for the next code either of them ships.
 *
 * It does not cover OpenSSL's `ERR_SSL_*` family, which Node builds at run
 * time out of OpenSSL's own reason strings and which therefore has no list
 * to measure (the longest in the binary runs to 44). A TLS failure whose
 * code is that long prints its message without the code, which is the cost
 * this bound was accepted at.
 */
export const MOST_OF_A_CODE = 40;

/** Node's and undici's own spelling, held to that length. */
const A_CODE = new RegExp(`^[A-Z0-9_]{1,${MOST_OF_A_CODE}}$`);

export function causeCode(e: unknown): string | undefined {
  const cause = (e as { cause?: unknown })?.cause;
  const code = (cause as { code?: unknown })?.code;
  return typeof code === "string" && A_CODE.test(code) ? code : undefined;
}

/**
 * The class of a thrown failure.
 *
 * A `ReadFailure` says so itself. Everything else that reaches a reader's
 * catch is something that did not happen rather than something anybody
 * refused — the budget's own `TimeoutError`, a socket that went away, a
 * protocol answer nobody anticipated — so it is transient, and costs one more
 * read rather than a red morning. A refusal is a decision this code made, and
 * a decision arrives as a `ReadFailure`.
 */
export function classOfThrown(e: unknown): FailureClass {
  return e instanceof ReadFailure ? e.failure : "transient";
}

/**
 * What a thrown thing SAID — never the name of the class that said it.
 *
 * `String(e)` on an `Error` is `"Error: " + e.message`, and on a `TypeError`
 * it is `"TypeError: …"`. That prefix is a word about JavaScript in a
 * sentence a curator reads about a page: it names the shape of an object in
 * a runtime nobody who reads the morning's issue is looking at. The browser
 * tier has printed the message alone since s34 — "Chrome closed the
 * connection", not "Error: Chrome closed the connection" — and both of its
 * printers ask here rather than each deciding again (`browser.ts`).
 *
 * The fetch tier does NOT use it, and that is the same decision rather than
 * a second one: `String(e)` is what its sentence has carried since s35, and
 * s36 promised the same errors from that tier. A prefix removed there would
 * be this slice rewriting a sentence nobody asked it to touch (Spec review,
 * 2026-09-24).
 *
 * Anything that is not an `Error` is printed as whatever it is: a thrower
 * may throw a string, and a string is already what it said.
 */
export function saidByThrown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
