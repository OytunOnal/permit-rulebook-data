import type { Fetcher } from "./core.js";
import { causeCode, classOfThrown, failureOfStatus } from "./failure.js";

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
export const MOST_OF_AN_ADDRESS = 200;

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
 * What it can and cannot see is worth stating. A literal address is judged,
 * and so are the two names that can only mean this machine — `localhost` and
 * anything under it. Every other name is taken at face value, because judging
 * one means resolving it and then hoping the resolution that mattered was the
 * one we saw. A source that points a hostname at a private address gets
 * through this.
 *
 * **The boundary, drawn once — sınır, 2026-09-24.** What these rules read: a
 * literal IPv4 in any spelling the URL parser normalises; a literal IPv6 with
 * `::` expanded, an embedded dotted quad taken as its last two groups, and an
 * IPv4-mapped address judged by the IPv4 rule on the address it embeds; and
 * the two names that can only mean this machine. What they do not read: the
 * transition and legacy prefixes that embed or stand for another address —
 * NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, the compat form `::/96`, site-local
 * `fec0::/10` — and any name that resolves to a private address. Those belong
 * to a check made at resolve time, which this project has not got and which
 * is a `later` candidate. Inside that boundary a corner is a lie told by an
 * address, not a finding against this code: the line is here, and it is drawn
 * where a spelling stops being decidable without asking the network.
 *
 * The rule is relative, not absolute: a source may not send the watch
 * somewhere it could not have gone itself. A public source redirecting into
 * the private network is refused; an entry that IS on such an address — a
 * test fixture, a mirror on a machine's own loopback — may redirect within
 * its own kind.
 */
export type AddressKind = "loopback" | "link-local" | "private" | "public";

const NAMED_LOOPBACK = [/^localhost$/i, /\.localhost$/i];

const IPV4_KINDS: [AddressKind, RegExp][] = [
  ["loopback", /^127\./], ["loopback", /^0\.0\.0\.0$/],
  // Link-local before the private ranges: 169.254.169.254 is where a cloud
  // runner keeps its credentials, and no source is ever there.
  ["link-local", /^169\.254\./],
  ["private", /^10\./], ["private", /^192\.168\./], ["private", /^172\.(1[6-9]|2\d|3[01])\./],
];

/**
 * An IPv6 literal as its eight groups, or `null` if it is not one.
 *
 * Written out rather than matched, because matching missed the spellings
 * that matter: `[::ffff:7f00:1]` IS 127.0.0.1 and `[::ffff:a9fe:a9fe]` IS
 * 169.254.169.254, and a pattern looking for `127.` or `169.254.` sees
 * neither (Security review, 2026-09-25). An address has many spellings and
 * only one meaning; this turns the spelling into the meaning.
 */
function hextets(literal: string): number[] | null {
  let text = literal.replace(/^\[/, "").replace(/\]$/, "");
  if (!text.includes(":")) return null;
  // A trailing dotted quad — `::ffff:127.0.0.1` — is the last two groups.
  let tail: number[] = [];
  const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted[1]!.split(".").map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    tail = [(octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    text = text.slice(0, dotted.index + 1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => part.split(":").filter(Boolean).map((group) => parseInt(group, 16));
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1]!) : [];
  if ([...left, ...right].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  const named = left.length + right.length + tail.length;
  const groups = halves.length === 2
    ? [...left, ...new Array(Math.max(0, 8 - named)).fill(0), ...right, ...tail]
    : [...left, ...tail];
  return groups.length === 8 ? groups : null;
}

function ipv4Kind(address: string): AddressKind {
  return IPV4_KINDS.find(([, shape]) => shape.test(address))?.[0] ?? "public";
}

export function addressKind(hostname: string): AddressKind {
  if (NAMED_LOOPBACK.some((shape) => shape.test(hostname))) return "loopback";
  const groups = hextets(hostname);
  if (!groups) return ipv4Kind(hostname);
  // An IPv4-mapped address is that IPv4 address, and takes its rule.
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [a, b] = [groups[6]!, groups[7]!];
    return ipv4Kind([a >> 8, a & 0xff, b >> 8, b & 0xff].join("."));
  }
  // `::` (unspecified) and `::1` both mean this machine.
  if (groups.every((g) => g === 0)) return "loopback";
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return "loopback";
  if ((groups[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((groups[0]! & 0xfe00) === 0xfc00) return "private";
  return "public";
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
  /**
   * What this watch will not ask for at all: a malformed address, one
   * carrying a name and password, one on a scheme that is not a page.
   *
   * Refused before anything is requested and without repeating what is
   * wrong. `String(e)` on a credentialled address put the password into the
   * error, the log, a flag and an issue (Security review, 2026-09-24); the
   * coverage gate refuses such an entry in the watchlist too, where it is a
   * curator's to fix, and this is the floor under that for a url arriving by
   * any other road.
   */
  const refused = refusedAddress(url);
  // Refused by us, every one of them: the floor declined to make the request
  // at all, and it will decline the same request three minutes later.
  if (refused) return { ok: false, error: refused, failure: "refused-by-us" };
  // Everything below is inside the try because `new URL` throws, and one bad
  // entry used to take the whole pass down with it — no reports, no state and
  // no flags for the other forty-four sources, where it had been a single
  // `unreachable` (Standards review, 2026-09-24).
  try {
    const entry = new URL(url);
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
         * A target carrying a name and password is refused before it is
         * asked for, and the credentials are never printed.
         *
         * `user:pass@host` keeps the origin, so the check below would pass
         * it; undici then refuses it at request time and the thrown string —
         * credentials and all — became the error, with no status to say what
         * the source had actually answered (Security review, 2026-09-24).
         */
        const forbidden = refusedTarget(next, entry.hostname);
        if (forbidden)
          return { ok: false, status: res.status, error: `HTTP ${res.status} ${forbidden}`, failure: "refused-by-us" };
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
            // Ours: the source answered, and we declined to follow it.
            failure: "refused-by-us",
          };
        if (hop >= MOST_HOPS)
          return {
            ok: false,
            status: res.status,
            // Where it had got to, not where it started: under `anywhere` a
            // chain may have left the entry's origin long before the cap.
            error: `redirected more than ${MOST_HOPS} times, last to ${shortAddress(next.origin + next.pathname)}`,
            failure: "refused-by-us",
          };
        target = next.href;
        continue;
      }

      // 408, 425, 429 and every 5xx may answer differently in three minutes;
      // every other 4xx is a wall, a page that moved or a page that is gone.
      // The rule is `failure.ts`'s, so both readers read the same one.
      if (!res.ok)
        return { ok: false, status: res.status, error: `HTTP ${res.status}`, failure: failureOfStatus(res.status) };
      const body = new Uint8Array(await res.arrayBuffer());
      // An empty body is not a page, whatever the status line says. EUR-Lex
      // answers this fetcher with `202 Accepted` and nothing at all — a bot
      // challenge — and `res.ok` is true for it, so the pass would have recorded
      // a blank snapshot as a successful read and reported "unchanged" ever
      // after (measured 2026-09-10, s8).
      if (body.byteLength === 0)
        return {
          ok: false, status: res.status, error: `HTTP ${res.status} with an empty body`,
          // The challenge is over by the next read, so this is worth one.
          failure: "transient",
        };
      return { ok: true, body, ...(target !== url ? { from: shortAddress(target) } : {}) };
    }
  } catch (e) {
    /**
     * Where `fetch failed` stops being five words.
     *
     * Node wraps every socket failure as `TypeError: fetch failed`, the same
     * text for a reset connection, a name that does not resolve and a connect
     * timeout — three of the runs this slice was written for say exactly that
     * and nothing else, and the queue line guessed "timeouts" because the log
     * could not say. The cause's CODE is appended and its MESSAGE never is:
     * undici writes the address into the message, and an error travels into a
     * log line, a flag file and the issue that flag becomes.
     */
    const code = causeCode(e);
    return {
      ok: false,
      error: code ? `${String(e)} (${code})` : String(e),
      failure: classOfThrown(e),
    };
  }
};
