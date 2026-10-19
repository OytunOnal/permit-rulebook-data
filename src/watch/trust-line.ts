import { noteOfLength } from "./failure.js";

/**
 * The trust line: where the watch may go.
 *
 * One rule for both readers, asked at the four moments a source has: the
 * entry address, a redirect target, the addresses a name resolves to, and the
 * page a reader ends on. Each question answers with a refusal or `null`. A
 * refusal names the kind of address and never the address past what the
 * printers below allow, because a refusal travels into the log line, a flag
 * and the issue that flag becomes (`failure.ts`'s opening sentence). Crossing
 * the line is `refused-by-us` wherever it is asked.
 *
 * What it reads: a literal IPv4 in any spelling the URL parser normalises; a
 * literal IPv6 with `::` expanded, an embedded dotted quad taken as its last
 * two groups, an IPv4-mapped address judged by the IPv4 rule on the address it
 * embeds, and the prefixes that carry or stand for another address — NAT64
 * `64:ff9b::/96`, 6to4 `2002::/16`, the compat form `::/96` and site-local
 * `fec0::/10`; the two names that can only mean this machine; and every
 * address a resolver returns for any other name. What it does not read: an
 * address the operating system substitutes below the fetcher's lookup hook (a
 * `hosts` file, a VPN's split DNS, NAT on the path); a name the browser
 * resolves for itself, which `browser.ts`'s header states; and a source that is
 * genuinely reachable on the open web and merely hostile in what it says,
 * which is what the readings and the slice markers are for.
 *
 * The rule is relative, not absolute: a source may not send the watch
 * somewhere it could not have gone itself. A public source redirecting into the
 * private network is refused; an entry that IS on such an address — a test
 * fixture, a mirror on a machine's own loopback — may move within its own kind.
 * A link-local address is refused for everybody: it is where a hosted runner
 * keeps its credentials, and no source lives there.
 */

/**
 * How far a redirect may be followed, and why that is not one answer.
 *
 * `same-origin` is the rule for anything whose bytes become a READING: what a
 * source redirects to is not the source, and an off-site landing — or a
 * downgrade to plain http, where anyone on the path may rewrite the page —
 * must not be hashed as the authority's words and checked against its quotes.
 *
 * `anywhere` is the rule for an entry that produces no reading. A learn link
 * backs no value and is never compared; what is watched is that a person who
 * clicks it arrives somewhere. Following it the way that person's browser
 * would is the only way to learn that, and refusing a redirect they would
 * happily take reports a working link as broken: `anabin.kmk.org` answers
 * https with a 301 to plain http on the same host.
 *
 * The rest of the trust line holds under both, and the fetcher's hop cap
 * applies to both.
 */
export type RedirectPolicy = "same-origin" | "anywhere";

/**
 * As much of an address as belongs in a message a person reads.
 *
 * Everything past this is a page's choice, not a fact about the source: a
 * `location` header or a `history.pushState` can make an address as long as a
 * page likes. Both readers bound the same kind of string with it, and the
 * browser reader's in-page code is handed it too.
 */
export const MOST_OF_AN_ADDRESS = 200;

/**
 * An address-shaped field bounded, and what was cut said in the one spelling
 * for it.
 *
 * **Characters, not the UTF-16 units a runtime stores them in.** A cut on
 * units could end an astral path in half a character, and a lone surrogate is
 * not valid UTF-8: the log line escapes it as a bare `\udXXX` and the issue
 * renders a replacement character.
 *
 * **A bound is all this applies, and that is the caller's invariant.** Every
 * caller hands it URL-serialised text — a parsed `origin`, `host + pathname`, a
 * `location.href`, a punycoded name — and the URL serializer percent-encodes
 * every code point above U+007E in a path, so a character that prints nothing
 * cannot arrive here spelled as itself. A caller that passes a page's words
 * unserialised asks `printableWithin` first: this bounds a field rather than
 * sanitising a sentence.
 *
 * The note is asked of `failure.ts`, which owns the wording, so a curator reads
 * one spelling wherever this package shortens something. The bound is on the
 * ADDRESS and the note is added after it, where `printableWithin`'s bound is on
 * the whole sentence: that one bounds all a line says about a failure, this one
 * bounds one field inside a line that says more.
 */
export function shortenAddress(address: string): string {
  const characters = [...address];
  return characters.length > MOST_OF_AN_ADDRESS
    ? `${characters.slice(0, MOST_OF_AN_ADDRESS).join("")}${noteOfLength(characters.length)}`
    : address;
}

/**
 * The same address with its credentials taken out, and nothing else changed.
 *
 * This is what a REPORT carries, and a report's url is not only read by
 * people: the unread list is keyed by it and the site looks that key up
 * against the dataset's own source urls. So it is stripped and not shortened,
 * and not normalised in any other way — a truncated or re-spelled url would
 * match nothing there, and the source would drop silently out of the site's
 * freshness sentence. The path and query stay for the same reason: EUR-Lex's
 * entry IS its query string.
 */
export function stripCredentials(url: string): string {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "(not an address)"; }
  parsed.username = "";
  parsed.password = "";
  return parsed.href;
}

/**
 * The same address as a person should see it: credentials out, and bounded.
 *
 * For a log line, a flag or an issue. The credentials are removed for what is
 * safe; the bound is for what is readable.
 */
export function printAddress(url: string): string {
  return shortenAddress(stripCredentials(url));
}

type AddressKind = "loopback" | "link-local" | "private" | "public";

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
 * Written out rather than matched, because a pattern looking for `127.` or
 * `169.254.` sees neither `[::ffff:7f00:1]` nor `[::ffff:a9fe:a9fe]`, which ARE
 * those addresses. An address has many spellings and only one meaning; this
 * turns the spelling into the meaning.
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

function addressKind(hostname: string): AddressKind {
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
   * The prefixes that carry another address.
   *
   * Each is an IPv4 address wearing an IPv6 spelling: `64:ff9b::a9fe:a9fe`
   * (NAT64), `2002:a9fe:a9fe::1` (6to4) and `::a9fe:a9fe` (the deprecated
   * compat form) are all 169.254.169.254. Each takes the rule of the address it
   * carries, which is why a prefix carrying a public address stays public
   * rather than being refused by association.
   */
  // `64:ff9b`, which both NAT64 prefixes below start with.
  const inNat64 = groups[0] === 0x0064 && groups[1] === 0xff9b;
  // The compat form `::/96`, and NAT64's `64:ff9b::/96`: the last two groups.
  const nat64 = inNat64 && groups.slice(2, 6).every((g) => g === 0);
  if (leading(6) || nat64) return ipv4Kind(carried(groups[6]!, groups[7]!));
  // 6to4's `2002::/16`: the first two groups after the prefix.
  if (groups[0] === 0x2002) return ipv4Kind(carried(groups[1]!, groups[2]!));
  // NAT64's local-use `64:ff9b:1::/48` carries an IPv4 address too, but its
  // operator chooses where inside the prefix it sits (RFC 8215, at any of RFC
  // 6052's prefix lengths), so no fixed position can be read: all of it is
  // private.
  const nat64LocalUse = inNat64 && groups[2] === 0x0001;
  if (nat64LocalUse) return "private";
  if ((groups[0]! & 0xffc0) === 0xfe80) return "link-local";
  if ((groups[0]! & 0xfe00) === 0xfc00) return "private";
  // Site-local, deprecated and still routed on plenty of networks.
  if ((groups[0]! & 0xffc0) === 0xfec0) return "private";
  return "public";
}

/**
 * Whether an address of this kind may be connected to at all, given where the
 * chain started: one rule for a redirect target spelled as a literal and for
 * every address a name resolves to.
 */
function allowedFrom(going: AddressKind, entryHost: string): boolean {
  if (going === "link-local") return false;
  // The relative rule. An entry on loopback may move within loopback; it may
  // not step sideways into the private network, and a public source may do
  // neither.
  return going === "public" || going === addressKind(entryHost);
}

/** Whether a url's scheme is a page this watch reads. */
function isPage(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * A url that is not a page, as a refusal names it: by its scheme, bounded,
 * because an entry or a `location` header chooses how long a scheme is.
 */
function notAPage(url: URL): string {
  return `a ${shortenAddress(url.protocol.replace(":", ""))} address, which is not a page this watch reads`;
}

/**
 * The entry question: why the watch will not ask for this entry address at
 * all — malformed, carrying a name and password, on a scheme that is not a
 * page, or link-local — or `null`.
 *
 * Asked before either reader opens anything. Credentials a reader sends are
 * credentials it can leak, a scheme that is not a page is not a source, and a
 * link-local address is where a hosted runner's credentials answer. A NAME in
 * the entry is judged at the connection, by the resolution question.
 *
 * Malformed is refused here too, and like every refusal here it says what is
 * wrong without repeating the thing that is wrong: an address that fails to
 * parse may still carry a password.
 */
export function judgeEntry(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return "the entry address is not an address"; }
  if (parsed.username || parsed.password)
    return "the entry address carries a name and password, which this watch will not send";
  if (!isPage(parsed)) return `the entry address is ${notAPage(parsed)}`;
  if (addressKind(parsed.hostname) === "link-local")
    return "the entry address is a link-local address and never a source";
  return null;
}

/**
 * Why a redirect is not followed, and which part of the trust line it crossed:
 * `place` when the target is somewhere the watch may not go under either
 * setting, `origin` when it leaves the entry's origin under `same-origin`. The
 * reader says the source's own answer beside it, and where that goes in the
 * sentence depends on which.
 */
export interface RedirectRefusal { rule: "place" | "origin"; says: string }

/**
 * The redirect question: why the watch will not follow a redirect to
 * `target`, or `null`.
 *
 * `entry` is where the chain started: its host for the relative rule, its
 * origin for `same-origin`. A target carrying a name and password keeps its
 * origin, so it is refused on its own before the origin is asked about. The
 * target is printed no further than its origin for a place, and bounded.
 */
export function judgeRedirect(target: URL, entry: URL, setting: RedirectPolicy): RedirectRefusal | null {
  const place = refusedPlace(target, entry.hostname);
  if (place) return { rule: "place", says: place };
  if (setting === "same-origin" && target.origin !== entry.origin)
    return {
      rule: "origin",
      says: `redirected off the site: asked ${entry.origin}, sent to ${shortenAddress(`${target.origin}${target.pathname}`)}`,
    };
  return null;
}

function refusedPlace(target: URL, entryHost: string): string | null {
  if (!isPage(target)) return `to ${notAPage(target)}`;
  if (target.username || target.password)
    return "to an address carrying a name and password, which this watch will not send";
  const going = addressKind(target.hostname);
  if (going === "link-local")
    return `to ${shortenAddress(target.origin)}, which is a link-local address and never a source`;
  if (!allowedFrom(going, entryHost))
    return `to ${shortenAddress(target.origin)}, which is on a ${going} address and not the open web`;
  return null;
}

/**
 * The resolution question: why a name may not be connected to, given every
 * address it resolved to, or `null`.
 *
 * ALL of a name's addresses are judged and one refusal refuses the name. A
 * reader that took the first allowed address out of a list would be letting
 * whoever wrote the list choose which answer mattered.
 *
 * The refusal names the KIND and not the address: what a name stands for is
 * the source's business and this watch's finding, and not something to write
 * where a failure's text ends up.
 */
export function judgeResolution(name: string, addresses: readonly string[], entryHost: string): string | null {
  for (const address of addresses) {
    const going = addressKind(address);
    if (going === "link-local")
      return `${shortenAddress(name)} resolves to a link-local address, which is never a source`;
    if (!allowedFrom(going, entryHost))
      return `${shortenAddress(name)} resolves to a ${going} address and not the open web`;
  }
  return null;
}

/**
 * The landing question: why a reading may not be taken where the reader ended
 * up, or `null`.
 *
 * `asked` is the ENTRY's origin, not wherever navigation happened to end: a
 * baseline read off the loaded page hands the decision to whoever the page
 * redirects to. A chain that leaves and comes back ends where it started, which
 * is the whole of what is asked. The address the reader is at is the page's to
 * choose, so it is bounded.
 */
export function judgeLanding(asked: string, landed: string, setting: RedirectPolicy): string | null {
  if (setting !== "same-origin") return null;
  if (originOf(landed) === asked) return null;
  return `the page was asked for at ${asked} and the browser is at ${shortenAddress(landed)}`;
}

function originOf(address: string): string | null {
  try { return new URL(address).origin; } catch { return null; }
}
