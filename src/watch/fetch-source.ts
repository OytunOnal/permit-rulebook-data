import { lookup as systemLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import type { LookupFunction } from "node:net";
import type { Fetcher, FetchResult } from "./core.js";
import {
  causeCode, classOfThrown, failureOfStatus, MOST_OF_A_FAILURE, printableWithin, ReadFailure,
} from "./failure.js";
import { ask, ENCODINGS_ASKED_FOR } from "./request.js";
import {
  boundedAddress, type RedirectPolicy, refusalOfEntryAddress, refusalOfRedirect, refusalOfResolvedAddresses,
} from "./trust-line.js";

/**
 * The watch's first reader: one HTTP request, no browser.
 *
 * Lifted out of `cli-watch.ts` on 2026-09-24 so that it can be tested. It was
 * a closure inside a script, which meant the one thing worth proving about it
 * — where it will and will not follow a redirect — could not be asked in a
 * test at all.
 */

/**
 * Who is asking — and the address travels beside the name, not inside it.
 *
 * The name used to carry the repository in parentheses, the way a crawler
 * conventionally does, and `inclusion.gob.es` answered 403 to exactly that:
 * the watch failed every day from 2026-09-11 to 15 and Spain's salary
 * threshold went unread for eight days while the site still said "re-read
 * daily". Measured on 2026-09-15, same host, same minute: the full string 403,
 * the string without its trailing purpose word 403,
 * `Mozilla/5.0 (compatible; …; +https://…)` 403 — and
 * `permit-rulebook-watch/0.1` **200**, 299,066 bytes. The filter objects to a
 * URL inside the User-Agent, not to a reader that names itself. So the name
 * stays, unique enough to find this repository by, and the link moved to a
 * header of its own, which the same host serves happily (data #18).
 */
const WATCH_NAME = "permit-rulebook-watch/0.1";

/** Where to find whoever sent it, in the header the 403 above bought. */
const WATCH_CONTACT = "https://github.com/OytunOnal/permit-rulebook-data";

/**
 * How long one source gets, on either tier — the whole of it, redirects
 * included.
 *
 * The fetcher is where this number lives because the scenario put it there:
 * point 5 asks the browser for "a per-entry budget of 30 s, like the
 * fetcher's", which makes the fetcher the origin of the figure and the
 * browser a borrower of it. `core.ts` would be the wrong home — it is the
 * engine both readers are injected into and knows nothing about sockets or
 * browsers — so the browser imports it from here.
 *
 * It is a budget per SOURCE and not per request. Armed once outside the hop
 * loop, because arming it inside let one source hold six of them
 * (Spec review, 2026-09-24).
 */
export const BUDGET_MS = 30_000;

/**
 * How many hops a source may take within its own site before we stop.
 *
 * Generous enough for the journeys real sources make — a trailing slash, a
 * language prefix, the Opportunity Card's cookie check — and small enough
 * that a loop ends as a refusal rather than as a hang.
 */
const MOST_HOPS = 5;

/** One answer from a resolver: an address, and which family it belongs to. */
export interface ResolvedAddress { address: string; family: number }

/**
 * What answers "where is this name?".
 *
 * The seam and the mechanism are the same thing. This is the shape of the
 * `lookup` hook Node's request takes, narrowed to the one way this fetcher
 * asks — always for ALL of a name's addresses, because one refused address
 * refuses the name — so that a test can say what a name means without owning
 * a DNS server, and so that the address that was judged is the address the
 * socket is handed.
 */
export type Resolver = (
  hostname: string,
  options: { all: true },
  done: (error: NodeJS.ErrnoException | null, addresses: ResolvedAddress[]) => void,
) => void;

/**
 * The system resolver, which is what every source gets.
 *
 * This slice is not a DNS client: the operating system answers, exactly as it
 * answered `fetch`, and all that changed is that the answer is now judged and
 * then used rather than judged by nobody.
 */
export const systemResolver: Resolver = (hostname, options, done) => {
  systemLookup(hostname, { ...options, all: true }, done);
};

/**
 * The hook the connection is made through: resolve, judge, hand back what was
 * judged.
 *
 * Refusing here refuses before any packet leaves — the hook is called with the
 * hostname and an error given back to it ends the request with no socket at
 * all (probed 2026-09-24 on Node v24.20.0). It is never called for an address
 * the URL parser could already read as an address; those are judged where
 * they are spelled, by the trust line's entry and redirect questions.
 */
function judgedLookup(entryHost: string, resolver: Resolver): LookupFunction {
  return (hostname, options, done) => {
    resolver(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) { done(error, []); return; }
      const refusal = refusalOfResolvedAddresses(hostname, addresses.map((one) => one.address), entryHost);
      // A decision, carrying its own class: the trust line declined the
      // request, which is never the source having a bad minute.
      if (refusal) { done(new ReadFailure(refusal, "refused-by-us"), []); return; }
      // What was judged is what the socket gets, in the shape Node asked for.
      if (options.all) { done(null, addresses); return; }
      const first = addresses[0];
      if (!first) { done(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), []); return; }
      done(null, first.address, first.family);
    });
  };
}

/**
 * Every header this watch puts on the wire, and the order they go in.
 *
 * The first two are the watch's own and the reason they are shaped this way
 * is written where they are declared, at the top of this file. The other four are `fetch`'s, kept
 * verbatim: measured 2026-09-24 against this repository's Node (v24.20.0),
 * undici sent an `accept` of any type at all, an `accept-language` of any
 * language, `sec-fetch-mode: cors` and `accept-encoding: gzip, deflate` on
 * every request this tier made — the four written out below, where they can
 * be read — and the 46 sources answered that client. s36 changed the
 * mechanism underneath; it did not set out to introduce this watch to anybody
 * a second time, and a bot wall that answered one set of headers is under no
 * obligation to answer another.
 *
 * `accept-encoding` is the one with a consequence past politeness: sources
 * send gzip because of it, and the body is unpacked in `request.ts` before
 * anything is fingerprinted. It is that file's own `ENCODINGS_ASKED_FOR` and
 * not a second spelling of it — and that constant is itself named from the
 * table that unpacks them, so this header cannot come to ask for an encoding
 * the watch cannot read.
 */
const ASKING: Readonly<Record<string, string>> = Object.freeze({
  "user-agent": WATCH_NAME,
  "x-source-contact": WATCH_CONTACT,
  "accept": "*/*",
  "accept-language": "*",
  "sec-fetch-mode": "cors",
  "accept-encoding": ENCODINGS_ASKED_FOR,
});

/**
 * A failure's sentence with the answer that came before it, when there was one.
 *
 * The answer's clause goes FIRST. Put last it attached itself to whatever
 * clause the sentence happened to end on — "…, which is no page this watch
 * reads, after HTTP 200" reads as the READING being after the answer rather
 * than the refusal (Spec review, 2026-09-24). In front it reads as a sentence
 * in both shapes this branch has: a refusal decided after the source spoke,
 * and a socket that died while it was still speaking.
 *
 * The structured `status` a fetcher returns stops at the report's door: a
 * `WatchReport` carries the sentence and not the number, and `core.ts` — the
 * one caller — declares the field and never reads it. The field is the shape
 * the two readers answer in, and what the tests read; the SENTENCE is what a
 * curator finds in the log line, the flag file and the issue that flag
 * becomes. So a refusal decided after a source answered says the answer in
 * words, which is what the redirect refusals have always done ("HTTP 302, not
 * followed").
 *
 * The status only. What the source SAID past its status line is the source's
 * own words and stays out (`failure.ts`'s opening sentence).
 *
 * Exported because a test that asks whether the answer reached the sentence
 * was retyping the clause — `"after HTTP 302"` — which is the fault
 * `MEASURED` closed one file over: a check keyed to a substring pins the
 * words rather than the decision, and the decision here is that the answer's
 * clause comes FIRST and names the status (Standards review, 2026-09-24).
 */
export function afterAnswer(sentence: string, status: number | undefined): string {
  return status === undefined ? sentence : `after HTTP ${status}, ${sentence}`;
}

/** 2xx and nothing else, which is what `fetch`'s `res.ok` meant. */
function answered(status: number): boolean {
  return status >= 200 && status < 300;
}

export const fetchSource = (async (
  url: string,
  redirects: RedirectPolicy,
  /**
   * Where a name becomes an address — `node:dns`'s own by default.
   *
   * It is a parameter so that a test can inject one, and it is the LAST
   * parameter with a default so that the port `core.ts` injects is unchanged:
   * the run hands this function a url and a redirect policy, and gets the
   * system's answer.
   */
  resolver: Resolver = systemResolver,
): Promise<FetchResult> => {
  /**
   * The trust line's entry question, asked before anything is requested.
   *
   * Its refusal does not repeat what is wrong: `String(e)` on a credentialled
   * address puts the password into the error, and from there into the log, a
   * flag and an issue. The coverage gate refuses a credentialled entry in the
   * watchlist too, where it is a curator's to fix; this holds for a url
   * arriving by any other road.
   */
  const refused = refusalOfEntryAddress(url);
  // Refused by us, every one of them: the trust line declined the request,
  // and it will decline the same request three minutes later.
  if (refused) return { ok: false, error: refused, failure: "refused-by-us" };
  /**
   * The last thing this source actually said, kept for a refusal made after it.
   *
   * A hop refused from its `location` header reports the redirect's own status,
   * because that is the answer the source gave (s34). A hop refused at the
   * connection — the resolver answered an address this watch will not dial —
   * is the same hop, refused a few microseconds later, and reported the same
   * answer with the status missing. Where a refusal was DECIDED is not the
   * source's business; what the source said is, so it is said either way.
   *
   * It stays `undefined` until something answers, which is the honest report
   * for an entry refused before it was ever asked.
   */
  let answerStatus: number | undefined;
  // Everything below is inside the try because `new URL` throws, and one bad
  // entry used to take the whole pass down with it — no reports, no state and
  // no flags for the other forty-four sources, where it had been a single
  // `unreachable` (Standards review, 2026-09-24).
  try {
    const entry = new URL(url);
    // The entry's own address was judged above; a NAME in it is judged at the
    // connection, by the hook below.
    let target = url;
    // One deadline for the source, shared by every hop it makes. It is a
    // moment and not a signal because each hop is its own request now, and
    // each is given what is left of it.
    const deadline = Date.now() + BUDGET_MS;
    const lookup = judgedLookup(entry.hostname, resolver);
    /**
     * One connection pool per source, and nothing that outlives it.
     *
     * `fetch` pooled per origin and kept sockets warm between sources; this
     * keeps the same `connection: keep-alive` on the wire and the same reuse
     * between the hops of one source, and then closes them, because a socket
     * held open across a pass is a socket nothing in this file is watching.
     */
    const pools = { "http:": new HttpAgent({ keepAlive: true }), "https:": new HttpsAgent({ keepAlive: true }) };
    try {
      for (let hop = 0; ; hop++) {
        const here = new URL(target);
        /**
         * Redirects are followed by hand, and judged BEFORE they are taken.
         *
         * `redirect: "follow"` let the browser make the off-site request for us:
         * the watch's name and its contact header reached a third party, and a
         * source could point this reader at any address it liked — a link-local
         * one included — before anything asked whether it should go there. The
         * origin check that came after was then reporting the far server's
         * status as the source's (measured `status: 200`, from somebody else's
         * page). So: ask, read the `location`, and refuse an off-origin target
         * without requesting it (Security review, 2026-09-24).
         *
         * Nothing here follows anything by itself: `node:http` has no opinion
         * about a `location` header, which is the one thing the move off
         * `fetch` made simpler rather than harder.
         */
        const res = await ask(here, {
          headers: ASKING,
          lookup,
          agent: here.protocol === "https:" ? pools["https:"] : pools["http:"],
          msLeft: deadline - Date.now(),
        });
        answerStatus = res.status;

        if (res.status >= 300 && res.status < 400) {
          // A redirect's body is nobody's reading, and the socket is wanted for
          // the hop.
          res.discard();
          const location = res.location;
          if (!location)
            return {
              ok: false, status: res.status, error: `HTTP ${res.status} with nowhere to go`,
              // The source's own broken answer, and the same one tomorrow.
              failure: "refused-by-source",
            };
          let next: URL;
          try { next = new URL(location, target); }
          catch {
            return {
              ok: false, status: res.status, failure: "refused-by-source",
              error: `HTTP ${res.status} to somewhere that is not an address`,
            };
          }
          /**
           * The trust line's redirect question, asked before the target is.
           *
           * The status reported is the REDIRECT's own, because that is the
           * answer this source gave; the refused target was never asked. A
           * forbidden address says the status first, and a target off the
           * entry's origin says it after where it was sent.
           */
          const refusal = refusalOfRedirect(next, entry, redirects);
          if (refusal)
            return {
              ok: false,
              status: res.status,
              error: refusal.crossed === "forbidden-address"
                ? `HTTP ${res.status} ${refusal.reason}`
                : `${refusal.reason} (HTTP ${res.status}, not followed)`,
              // Ours: the source answered, and we declined to follow it.
              failure: "refused-by-us",
            };
          if (hop >= MOST_HOPS)
            return {
              ok: false,
              status: res.status,
              // Where it had got to, not where it started: under `anywhere` a
              // chain may have left the entry's origin long before the cap.
              error: `redirected more than ${MOST_HOPS} times, last to ${boundedAddress(next.origin + next.pathname)}`,
              failure: "refused-by-us",
            };
          target = next.href;
          continue;
        }

        // 408, 425, 429 and every 5xx may answer differently in three minutes;
        // every other 4xx is a wall, a page that moved or a page that is gone.
        // The rule is `failure.ts`'s, so both readers read the same one.
        if (!answered(res.status)) {
          res.discard();
          return { ok: false, status: res.status, error: `HTTP ${res.status}`, failure: failureOfStatus(res.status) };
        }
        const body = await res.bytes();
        // An empty body is not a page, whatever the status line says. EUR-Lex
        // answers this fetcher with `202 Accepted` and nothing at all — a bot
        // challenge — and a 2xx is true for it, so the pass would have recorded
        // a blank snapshot as a successful read and reported "unchanged" ever
        // after (measured 2026-09-10, s8).
        if (body.byteLength === 0)
          return {
            ok: false, status: res.status, error: `HTTP ${res.status} with an empty body`,
            // The challenge is over by the next read, so this is worth one.
            failure: "transient",
          };
        return { ok: true, body, ...(target !== url ? { from: boundedAddress(target) } : {}) };
      }
    } finally {
      pools["http:"].destroy();
      pools["https:"].destroy();
    }
  } catch (e) {
    /**
     * A refusal the trust line made inside the connection says its own sentence.
     *
     * The lookup hook is several layers down — it is Node that calls it, and
     * what comes back up is a socket that never opened — so the decision
     * travels as a `ReadFailure`, carrying the class it was made with. It is
     * not dressed up as a failure that happened TO us, because it did not
     * happen: we declined it.
     *
     * Not bounded, and that is the same rule rather than a second one: a
     * `ReadFailure` here is OURS — the trust line's refusal, or the bound's own —
     * and the bound belongs where a SOURCE's string arrives, which is the
     * throw below (`failure.ts`, `MOST_OF_A_FAILURE`).
     */
    if (e instanceof ReadFailure)
      return {
        ok: false,
        ...(answerStatus !== undefined ? { status: answerStatus } : {}),
        error: afterAnswer(e.message, answerStatus),
        failure: e.failure,
      };
    /**
     * Where `fetch failed` stops being five words.
     *
     * Node wrapped every socket failure as `TypeError: fetch failed`, the same
     * text for a reset connection, a name that does not resolve and a connect
     * timeout — three of the runs s35 was written for say exactly that
     * and nothing else, and the queue line guessed "timeouts" because the log
     * could not say. The cause's CODE is appended and its MESSAGE never is:
     * the message is where the address is written (`failure.ts`'s opening
     * sentence).
     *
     * s36 moved this tier off `fetch` and kept the wrapper by hand
     * (`request.ts`), so the sentence a curator reads — and the one
     * `CONTRIBUTING.md` prints — is the same sentence it was.
     *
     * The answer travels with it for the same reason it travels with the
     * refusal above: a socket that dies mid-body, or a budget spent while the
     * page is still arriving, happens AFTER the source said something, and
     * what the source said is the source's own. It stays absent when nothing
     * ever answered, which is most of what lands here.
     */
    const code = causeCode(e);
    /**
     * Bounded and made printable here, because here is where a thrown thing
     * becomes a printed sentence — the same owner and the same rule as the
     * browser tier's, which asks for it at the throw in `cdp.ts` and again on
     * its own return path in `browser.ts`. One owner cuts the length AND takes
     * out what a terminal or a Markdown body would act on; neither tier has a
     * second opinion about either half (`printableWithin`).
     *
     * `request.ts`'s wrapper makes this five words most mornings, but a
     * wrapper is not a bound: anything thrown inside this `try` that never
     * passed through it — a lookup hook that throws where Node calls it, the
     * next thing added beside `ask` — arrives with whatever text it carries,
     * and that text is what travels into the log line, the flag file and the
     * issue that flag becomes (`failure.ts`'s opening sentence; Security
     * review, 2026-09-24).
     *
     * What is printed beside it is this tier's own and bounded already: a
     * cause code, which `MOST_OF_A_CODE` holds, and `afterAnswer`
     * adds a status number.
     */
    const said = printableWithin(String(e), MOST_OF_A_FAILURE);
    return {
      ok: false,
      ...(answerStatus !== undefined ? { status: answerStatus } : {}),
      error: afterAnswer(code ? `${said} (${code})` : said, answerStatus),
      failure: classOfThrown(e),
    };
  }
}) satisfies Fetcher;
