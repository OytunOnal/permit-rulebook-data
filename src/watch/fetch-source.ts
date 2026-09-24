import { lookup as systemLookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import type { LookupFunction } from "node:net";
import type { Fetcher, FetchResult, RedirectPolicy } from "./core.js";
import { causeCode, classOfThrown, failureOfStatus, ReadFailure } from "./failure.js";
import { ask, ENCODINGS_ASKED_FOR } from "./request.js";

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
 * What it reads is worth stating. A literal address is judged, in every
 * spelling that means the same address; so are the two names that can only
 * mean this machine — `localhost` and anything under it; and since s36 so is
 * every address the system resolver gives for any other name, judged inside
 * the `lookup` hook that hands the socket the address it will use. A name is
 * no longer taken at face value, and there is no second answer to hope about:
 * the resolution that is checked is the resolution that connects.
 *
 * **The boundary, redrawn — s36, 2026-09-24; drawn first as sınır, s34.**
 * What these rules read: a literal IPv4 in any spelling the URL parser
 * normalises; a literal IPv6 with `::` expanded, an embedded dotted quad
 * taken as its last two groups, an IPv4-mapped address judged by the IPv4
 * rule on the address it embeds, and the four prefixes that carry or stand
 * for another address — NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, the compat
 * form `::/96` and site-local `fec0::/10`; the two names that can only mean
 * this machine; and every address a resolver returns for any other name.
 * What they do not read: an address the OPERATING SYSTEM substitutes below
 * the hook — a `hosts` file, a VPN's split DNS, NAT on the path; the browser
 * tier, where Chrome resolves for itself and says so in its own header; and a
 * source that is genuinely reachable on the open web and merely hostile in
 * what it says, which is what the readings and the slice markers are for.
 * Inside that boundary a corner is a lie told by an address, not a finding
 * against this code.
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

/** The IPv4 address two groups carry, dotted, so the IPv4 rule can read it. */
function carried(high: number, low: number): string {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

export function addressKind(hostname: string): AddressKind {
  if (NAMED_LOOPBACK.some((shape) => shape.test(hostname))) return "loopback";
  const groups = hextets(hostname);
  if (!groups) return ipv4Kind(hostname);
  const leading = (upTo: number) => groups.slice(0, upTo).every((g) => g === 0);
  // An IPv4-mapped address is that IPv4 address, and takes its rule.
  if (leading(5) && groups[5] === 0xffff) return ipv4Kind(carried(groups[6]!, groups[7]!));
  // `::` (unspecified) and `::1` both mean this machine.
  if (groups.every((g) => g === 0)) return "loopback";
  if (leading(7) && groups[7] === 1) return "loopback";
  /**
   * The prefixes that carry another address, learnt in s36.
   *
   * Each of these is an IPv4 address wearing an IPv6 spelling, and the floor
   * read all three as public because it had never met them: `64:ff9b::a9fe:a9fe`
   * (NAT64), `2002:a9fe:a9fe::1` (6to4) and `::a9fe:a9fe` (the deprecated
   * compat form) are all 169.254.169.254, where a hosted runner keeps its
   * credentials, and s34's Security round requested each of them from a public
   * entry. An address has many spellings and one meaning; each takes the rule
   * of the address it carries, which is why a prefix carrying a public address
   * stays public rather than being refused by association.
   */
  // The compat form `::/96`, and NAT64's `64:ff9b::/96`: the last two groups.
  const nat64 = groups[0] === 0x0064 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
  if (leading(6) || nat64) return ipv4Kind(carried(groups[6]!, groups[7]!));
  // 6to4's `2002::/16`: the first two groups after the prefix.
  if (groups[0] === 0x2002) return ipv4Kind(carried(groups[1]!, groups[2]!));
  if ((groups[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((groups[0]! & 0xfe00) === 0xfc00) return "private";
  // Site-local, deprecated in 2004 and still routed on plenty of networks.
  if ((groups[0]! & 0xffc0) === 0xfec0) return "private";
  return "public";
}

/**
 * Whether an address of this kind may be connected to at all, given where the
 * chain started.
 *
 * One rule, three callers, because there is one rule: a redirect target
 * spelled as a literal, the entry's own address, and every address a name
 * resolves to. It was written out three times in the first draft of s36 and
 * the three copies had already begun to differ.
 */
export function allowedAddress(going: AddressKind, entryHost: string): boolean {
  // Never, for anybody: a link-local address is not a place a source lives,
  // and it is where a hosted runner's credentials answer.
  if (going === "link-local") return false;
  // Otherwise the relative rule: a source may not send this watch somewhere
  // it could not have gone itself. An entry on loopback — a fixture, a mirror
  // on this machine — may move within loopback; it may not step sideways into
  // the private network, and a public source may do neither.
  return going === "public" || going === addressKind(entryHost);
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
  if (going === "link-local")
    return `to ${shortAddress(next.origin)}, which is a link-local address and never a source`;
  if (!allowedAddress(going, entryHost))
    return `to ${shortAddress(next.origin)}, which is on a ${going} address and not the open web`;
  return null;
}

/**
 * Why a name may not be connected to, or `null` — the same rule, asked of
 * what the resolver answered instead of what the source spelled.
 *
 * ALL of a name's addresses are judged and one refusal refuses the name. A
 * reader that took the first allowed address out of a list would be letting
 * whoever wrote the list choose which answer mattered, and a resolver that
 * answers differently on a second call is the whole reason this check happens
 * at the connection (scenario point 2).
 *
 * The refusal names the KIND and not the address. What a name stands for is
 * the source's business and this watch's finding, and not something to write
 * where a failure's text ends up (`failure.ts`'s opening sentence).
 */
export function refusedResolution(name: string, addresses: string[], entryHost: string): string | null {
  for (const address of addresses) {
    const going = addressKind(address);
    if (going === "link-local")
      return `${shortAddress(name)} resolves to a link-local address, which is never a source`;
    if (!allowedAddress(going, entryHost))
      return `${shortAddress(name)} resolves to a ${going} address and not the open web`;
  }
  return null;
}

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
 * they are spelled, by `refusedTarget` and by the entry's own check.
 */
function floorLookup(entryHost: string, resolver: Resolver): LookupFunction {
  return (hostname, options, done) => {
    resolver(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) { done(error, []); return; }
      const refusal = refusedResolution(hostname, addresses.map((one) => one.address), entryHost);
      // A decision, carrying its own class: the floor declined to make the
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
 * Printers use this, and what a printer may print is `failure.ts`'s opening
 * sentence. The credentials are removed once, where the report is made; the
 * shortening belongs here, because it is about what is readable and not about
 * what is safe.
 */
export function printableAddress(url: string): string {
  return shortAddress(addressWithoutCredentials(url));
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
    const asked = entry.origin;
    /**
     * The entry's own address, judged by the rule that judges every hop.
     *
     * A url a curator typed is still an address (scenario point 4). What the
     * relative rule can refuse about the place a chain STARTS is only a
     * link-local one — an entry is, by definition, already on its own kind,
     * which is what keeps a loopback fixture readable. A NAME in the entry is
     * judged the other way round, at the connection, by the hook below.
     */
    if (!allowedAddress(addressKind(entry.hostname), entry.hostname))
      return {
        ok: false,
        error: "the entry address is a link-local address and never a source",
        failure: "refused-by-us",
      };
    let target = url;
    // One deadline for the source, shared by every hop it makes. It is a
    // moment and not a signal because each hop is its own request now, and
    // each is given what is left of it.
    const deadline = Date.now() + BUDGET_MS;
    const lookup = floorLookup(entry.hostname, resolver);
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
        return { ok: true, body, ...(target !== url ? { from: shortAddress(target) } : {}) };
      }
    } finally {
      pools["http:"].destroy();
      pools["https:"].destroy();
    }
  } catch (e) {
    /**
     * A refusal the floor made inside the connection says its own sentence.
     *
     * The lookup hook is several layers down — it is Node that calls it, and
     * what comes back up is a socket that never opened — so the decision
     * travels as a `ReadFailure`, carrying the class it was made with. It is
     * not dressed up as a failure that happened TO us, because it did not
     * happen: we declined it.
     */
    if (e instanceof ReadFailure)
      return {
        ok: false,
        ...(answerStatus !== undefined ? { status: answerStatus } : {}),
        error: e.message,
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
    return {
      ok: false,
      ...(answerStatus !== undefined ? { status: answerStatus } : {}),
      error: code ? `${String(e)} (${code})` : String(e),
      failure: classOfThrown(e),
    };
  }
}) satisfies Fetcher;
