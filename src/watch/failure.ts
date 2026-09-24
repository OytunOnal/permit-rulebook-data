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
 * It is NOT applied to every `ReadFailure`. Most of them are OURS — the step
 * diagnosis that names what the page offered instead of the option asked for
 * runs to five hundred characters on purpose, and is the whole reason a
 * curator can act on it. The bound belongs where a string arrives from the
 * source, which is at the throw.
 */
export const MOST_OF_A_FAILURE = 200;

export function shortFailure(text: string): string {
  if (text.length <= MOST_OF_A_FAILURE) return text;
  const note = `… (${text.length} characters)`;
  return `${text.slice(0, MOST_OF_A_FAILURE - note.length)}${note}`;
}

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
 * Forty is measured, not chosen. Against this repository's Node (v24.20.0,
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
const A_CODE = /^[A-Z0-9_]{1,40}$/;

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
