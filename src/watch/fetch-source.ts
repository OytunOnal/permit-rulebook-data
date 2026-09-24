import type { Fetcher } from "./core.js";

/**
 * The watch's first reader: one HTTP request, no browser.
 *
 * Lifted out of `cli-watch.ts` on 2026-09-24 so that it can be tested. It was
 * a closure inside a script, which meant the one thing worth proving about it
 * — where it will and will not follow a redirect — could not be asked in a
 * test at all.
 */

/** Who is asking. */
const WATCH_NAME = "permit-rulebook-watch/0.1";

/** Where to find whoever sent it. */
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

/**
 * As much of an address as belongs in a message a person reads.
 *
 * Everything past this is a page's choice, not a fact about the source: a
 * `location` header of 9,000 characters made a 9,111-character error, and a
 * redirect chain made a 12,023-character `read_at` (Security review,
 * 2026-09-24). The same bound the browser tier puts on the same kind of
 * string.
 */
const MOST_OF_AN_ADDRESS = 200;

export function shortAddress(address: string): string {
  return address.length > MOST_OF_AN_ADDRESS
    ? `${address.slice(0, MOST_OF_AN_ADDRESS)}… (${address.length} characters)`
    : address;
}

/**
 * Addresses a source may not send this watch to, however it asks.
 *
 * The floor under `anywhere`. Following a redirect the way a person's browser
 * follows one turned out to be WIDER than a browser: measured 2026-09-25, a
 * `data:` target was followed and its inline bytes read back as a reading, a
 * browser refuses that outright; and `169.254.169.254` — the address a cloud
 * runner keeps its credentials behind — was attempted, which on a hosted
 * runner is a request that reaches something. The policy permits a plaintext
 * hop on purpose, which means the next `Location` is chosen by whoever is on
 * the path and not only by the source, so the REQUEST is the harm even where
 * the bytes are never hashed.
 *
 * What it can and cannot see is worth stating: a literal address is judged
 * here, and a name is not, because judging a name means resolving it and then
 * hoping the resolution that mattered was the one we saw. A source that
 * points a hostname at a private address gets through this.
 *
 * The rule is relative, not absolute: a source may not send the watch
 * somewhere it could not have gone itself. A public source redirecting into
 * the private network is refused; an entry that IS on such an address — a
 * test fixture, a mirror on a machine's own loopback — may redirect within
 * its own kind.
 */
type AddressKind = "loopback" | "link-local" | "private" | "public";

const ADDRESS_KINDS: [AddressKind, RegExp][] = [
  ["loopback", /^localhost$/i], ["loopback", /\.localhost$/i],
  ["loopback", /^127\./], ["loopback", /^0\.0\.0\.0$/], ["loopback", /^\[?::1\]?$/],
  // Link-local first among the rest: 169.254.169.254 is where a cloud runner
  // keeps its credentials, and no source is ever there.
  ["link-local", /^169\.254\./], ["link-local", /^\[?fe80:/i],
  ["private", /^10\./], ["private", /^192\.168\./], ["private", /^172\.(1[6-9]|2\d|3[01])\./],
  ["private", /^\[?f[cd][0-9a-f]{2}:/i],
];

function addressKind(hostname: string): AddressKind {
  return ADDRESS_KINDS.find(([, shape]) => shape.test(hostname))?.[0] ?? "public";
}

/**
 * Why this redirect target is refused, or `null` to follow it.
 *
 * `entryHost` is where the chain started, so the relative rule above can be
 * applied. The address is never printed beyond its origin.
 */
export function refusedTarget(next: URL, entryHost: string): string | null {
  if (next.protocol !== "http:" && next.protocol !== "https:")
    return `to a ${next.protocol.replace(":", "")} address, which is not a page this watch will read`;
  if (next.username || next.password)
    return "to an address carrying a name and password, which this watch will not send";
  const going = addressKind(next.hostname);
  // Never, for anybody: a link-local address is not a place a source lives,
  // and it is where a hosted runner's credentials answer.
  if (going === "link-local")
    return `to ${shortAddress(next.origin)}, which is a link-local address and never a source`;
  // Otherwise the relative rule: a source may not send this watch somewhere
  // it could not have gone itself. An entry on loopback — a fixture, a mirror
  // on this machine — may move within loopback; it may not step sideways into
  // the private network, and a public source may do neither.
  if (going !== "public" && going !== addressKind(entryHost))
    return `to ${shortAddress(next.origin)}, which is on a ${going} address and not the open web`;
  return null;
}

/**
 * The refusal both readers give an address carrying a name and password, or
 * `null` when there is nothing to refuse.
 *
 * One owner, because it is one rule: no source this project reads needs
 * credentials, and a reader that sends them is a reader that can leak them.
 * The fetcher met it first; the browser reader asks the same question here
 * rather than spelling a second opinion of it.
 *
 * A malformed address is not this function's fault to report — it has its own
 * refusal, in each reader.
 */
export function refusedAddress(url: string): string | null {
  let parsed: URL;
  // Malformed is refused HERE too, rather than left to each reader. The
  // browser's gate used to miss a malformed-and-credentialled address
  // entirely, which was safe only because Node's parse error happens not to
  // quote its input — safety by somebody else's wording is not safety
  // (Security review, 2026-09-25). And like every refusal in this file, it
  // says what is wrong without repeating the thing that is wrong.
  try { parsed = new URL(url); } catch { return "the entry address is not an address"; }
  if (parsed.username || parsed.password)
    return "the entry address carries a name and password, which this watch will not send";
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return `the entry address is a ${parsed.protocol.replace(":", "")} address, which this watch does not read`;
  return null;
}

/**
 * The same address with its credentials taken out, and nothing else changed.
 *
 * This is what a REPORT carries, and a report's url is not only read by
 * people: the unread list is keyed by it and the site looks that key up
 * against the dataset's own source urls. So it is stripped and not shortened,
 * and not normalised in any other way — a truncated or re-spelled url would
 * match nothing there, and the source would drop silently out of the site's
 * freshness sentence (Standards review, 2026-09-25). The path and query stay
 * for the same reason: EUR-Lex's entry IS its query string.
 */
export function addressWithoutCredentials(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "(not an address)"; }
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}

/**
 * The same address as a person should see it: credentials out, and bounded.
 *
 * Printers use this — a log line, a flag file, the issue a flag becomes. The
 * credentials are removed once, where the report is made; the shortening
 * belongs here, because it is about what is readable and not about what is
 * safe.
 */
export function printableAddress(url: string): string {
  return shortAddress(addressWithoutCredentials(url));
}

export const fetchSource: Fetcher = async (url, redirects) => {
  // Inside the try, because `new URL` throws on a malformed one. Outside it,
  // one bad entry took the whole pass down with it — no reports, no state and
  // no flags for the other forty-four sources, where it had been one
  // `unreachable` (Standards review, 2026-09-24).
  const refused = refusedAddress(url);
  if (refused) return { ok: false, error: refused };
  try {
    const entry = new URL(url);
    /**
     * An entry address carrying a name and password is refused before it is
     * requested, and they are never printed.
     *
     * The redirect path was guarded in round 5 and this one was not: undici
     * refuses `user:pass@host` at request time, and `String(e)` put the
     * credentials into the error, the log, a flag and an issue (Security
     * review, 2026-09-24). The watchlist is curator data, so the coverage
     * gate refuses such an entry at `npm run check` too — this is the floor
     * under that, for a url that reaches here by any other road.
     */
    const asked = entry.origin;
    let target = url;
    // One deadline for the source, shared by every hop it makes.
    const until = AbortSignal.timeout(BUDGET_MS);
    for (let hop = 0; ; hop++) {
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
       */
      const res = await fetch(target, {
        redirect: "manual",
        // Who is asking, and where to find whoever sent it — but the address
        // travels beside the name rather than inside it.
        //
        // The name used to carry the repository in parentheses, the way a
        // crawler conventionally does, and `inclusion.gob.es` answered 403 to
        // exactly that: the watch failed every day from 2026-09-11 to 15 and
        // Spain's salary threshold went unread for eight days while the site
        // still said "re-read daily". Measured on 2026-09-15, same host, same
        // minute: the full string 403, the string without its trailing purpose
        // word 403, `Mozilla/5.0 (compatible; …; +https://…)` 403 — and
        // `permit-rulebook-watch/0.1` **200**, 299,066 bytes. The filter objects
        // to a URL inside the User-Agent, not to a reader that names itself. So
        // the name stays, unique enough to find this repository by, and the link
        // moves to a header of its own, which the same host serves happily
        // (data #18).
        headers: {
          "user-agent": WATCH_NAME,
          "x-source-contact": WATCH_CONTACT,
        },
        signal: until,
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location)
          return { ok: false, status: res.status, error: `HTTP ${res.status} with nowhere to go` };
        let next: URL;
        try { next = new URL(location, target); }
        catch { return { ok: false, status: res.status, error: `HTTP ${res.status} to somewhere that is not an address` }; }
        /**
         * A target carrying a name and password is refused before it is
         * asked for, and the credentials are never printed.
         *
         * `user:pass@host` keeps the origin, so the check below would pass
         * it; undici then refuses it at request time and the thrown string —
         * credentials and all — became the error, with no status to say what
         * the source had actually answered (Security review, 2026-09-24).
         */
        const forbidden = refusedTarget(next, entry.hostname);
        if (forbidden) return { ok: false, status: res.status, error: `HTTP ${res.status} ${forbidden}` };
        // Where a reading is at stake, what the source redirects to is not
        // the source. The status reported is the REDIRECT's own, because that
        // is the answer this source gave; the far server was never asked.
        //
        // An entry that produces no reading is followed the way a person's
        // browser follows — the policy comes from the strategy table, and the
        // reason is written there.
        if (redirects === "same-origin" && next.origin !== asked)
          return {
            ok: false,
            status: res.status,
            error: `redirected off the site: asked ${asked}, sent to ${shortAddress(`${next.origin}${next.pathname}`)} (HTTP ${res.status}, not followed)`,
          };
        if (hop >= MOST_HOPS)
          return {
            ok: false,
            status: res.status,
            // Where it had got to, not where it started: under `anywhere` a
            // chain may have left the entry's origin long before the cap.
            error: `redirected more than ${MOST_HOPS} times, last to ${shortAddress(next.origin + next.pathname)}`,
          };
        target = next.href;
        continue;
      }

      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const body = new Uint8Array(await res.arrayBuffer());
      // An empty body is not a page, whatever the status line says. EUR-Lex
      // answers this fetcher with `202 Accepted` and nothing at all — a bot
      // challenge — and `res.ok` is true for it, so the pass would have recorded
      // a blank snapshot as a successful read and reported "unchanged" ever
      // after (measured 2026-09-10, s8).
      if (body.byteLength === 0) return { ok: false, status: res.status, error: `HTTP ${res.status} with an empty body` };
      return { ok: true, body, ...(target !== url ? { from: shortAddress(target) } : {}) };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};
