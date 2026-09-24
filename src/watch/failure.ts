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
 * The MESSAGE is not taken: undici writes the address into it, and an error
 * travels into a log line, a flag file and the issue that flag becomes.
 */
export function causeCode(e: unknown): string | undefined {
  const cause = (e as { cause?: unknown })?.cause;
  const code = (cause as { code?: unknown })?.code;
  return typeof code === "string" ? code : undefined;
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
