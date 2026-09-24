import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Agent } from "node:http";
import type { LookupFunction } from "node:net";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { ReadFailure } from "./failure.js";

/**
 * One HTTP request, made by hand.
 *
 * The fetch tier used global `fetch` until s36. It moved off it for one
 * reason: `fetch` decides for itself what address a hostname means, and there
 * is no way in — undici takes a `dispatcher`, not a resolver, and a dispatcher
 * is undici, which is a dependency this project does not have. Node's own
 * `http`/`https` request takes a `lookup` hook that is handed the hostname and
 * gives back the address the socket will use, which is exactly the sentence
 * s36 needed the code to be able to say: connect to the address you checked.
 *
 * What that cost is written down here rather than discovered later. `fetch`
 * was doing four things this file now does: it chose the request headers, it
 * decompressed the body, it assembled the bytes, and it turned every socket
 * failure into one error with a cause. Redirects it was never doing — s34
 * already read `location` by hand — and TLS it still does, because the
 * hostname travels to `https.request` as the hostname: SNI and the
 * certificate's name are the NAME, and only the address underneath comes from
 * the hook (probed 2026-09-24: a request for `fixture.test` resolved by the
 * hook to 127.0.0.1 arrived with `servername: fixture.test`).
 */

/** What an answer looks like before anybody decides to read it. */
export interface Answer {
  status: number;
  /** The `location` header, or `null` — the only header a hop is decided on. */
  location: string | null;
  /** The body, decompressed. Asked for only where it is about to be read. */
  bytes(): Promise<Uint8Array>;
  /** Thrown away, which is what a redirect's body is. */
  discard(): void;
}

export interface Asking {
  /** Every header on the wire, in the order they are sent. */
  headers: Record<string, string>;
  /** Where a name is turned into the address this request will connect to. */
  lookup: LookupFunction;
  /** Kept per source, so the hops of one source share a connection. */
  agent: Agent;
  /** What is left of the source's whole budget, hops included. */
  msLeft: number;
}

/**
 * The error the budget running out produces, spelled as `fetch` spelled it.
 *
 * `AbortSignal.timeout` rejected with exactly this — a `TimeoutError`
 * `DOMException` whose text is Node's own — and that text travels into a log
 * line, a flag file and the issue a flag becomes. The move off `fetch` is a
 * change of mechanism and not a change of what a curator reads.
 */
function budgetSpent(): DOMException {
  return new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

/**
 * A socket failure, wearing the words the watch has always printed for one.
 *
 * `fetch` wrapped every one of them as `TypeError: fetch failed` with the real
 * error underneath as `cause`, and `causeCode` prints the CODE and never the
 * message — because a raw Node error writes the address into its message
 * (`connect ECONNREFUSED 10.0.0.5:443`) and an error travels into an issue.
 * Keeping the wrapper keeps both: the address stays out, and `fetch failed
 * (ECONNRESET)` is the same sentence in `CONTRIBUTING.md`, in the state file
 * and in every flag written before this slice.
 *
 * A `ReadFailure` passes through untouched: it is the floor's own refusal,
 * thrown inside the lookup hook, and it already knows what it is.
 */
function thrownAs(e: unknown): unknown {
  if (e instanceof ReadFailure || e instanceof DOMException) return e;
  return new TypeError("fetch failed", { cause: e });
}

/** Node keeps the first of a repeated header; this is that, typed. */
function oneHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The body as the page wrote it, not as the wire carried it.
 *
 * `fetch` did this invisibly, and it matters more than it looks: the watch
 * fingerprints these bytes, so a source that compresses differently from one
 * morning to the next would read as changed every day if the compressed
 * stream were what got hashed.
 *
 * Only what the request asked for is unpacked (`accept-encoding: gzip,
 * deflate`, measured from what `fetch` sent), plus `br` for a server that
 * sends it unasked. `deflate` has two spellings in the wild — zlib-wrapped, as
 * the RFC says, and raw — and the second is tried when the first fails, which
 * is what every browser does. Anything else is left exactly as it arrived,
 * which is what `fetch` did with an encoding it had not asked for.
 */
export function unpacked(bytes: Buffer, encoding: string | null): Uint8Array {
  if (bytes.byteLength === 0) return new Uint8Array(0);
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip": case "x-gzip": return new Uint8Array(gunzipSync(bytes));
    case "br": return new Uint8Array(brotliDecompressSync(bytes));
    case "deflate":
      try { return new Uint8Array(inflateSync(bytes)); }
      catch { return new Uint8Array(inflateRawSync(bytes)); }
    default: return new Uint8Array(bytes);
  }
}

export function ask(target: URL, asking: Asking): Promise<Answer> {
  return new Promise<Answer>((resolve, reject) => {
    const secure = target.protocol === "https:";
    const send = secure ? httpsRequest : httpRequest;
    const req = send({
      // `hostname` and not `host`: it is the parsed one, it carries no port,
      // and Node puts the brackets back round an IPv6 literal in the `Host`
      // header itself.
      hostname: target.hostname,
      port: target.port || (secure ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers: asking.headers,
      agent: asking.agent,
      lookup: asking.lookup,
    });

    /**
     * The budget, enforced on the socket rather than on a signal.
     *
     * One deadline per SOURCE is computed by the caller; what arrives here is
     * what is left of it, and it covers the body as well as the headers —
     * a source that answers in a millisecond and then dribbles the page for a
     * minute is the case a header-only timeout misses.
     */
    const timer = setTimeout(() => { req.destroy(budgetSpent()); }, Math.max(0, asking.msLeft));
    let answered = false;
    /** Where a failure goes once the answer is somebody else's to read. */
    let failBody: ((e: unknown) => void) | null = null;

    req.on("close", () => { clearTimeout(timer); });
    req.on("error", (e) => {
      clearTimeout(timer);
      const why = thrownAs(e);
      if (!answered) { answered = true; reject(why); return; }
      failBody?.(why);
    });
    req.on("response", (res: IncomingMessage) => {
      if (answered) { res.resume(); return; }
      answered = true;
      resolve({
        status: res.statusCode ?? 0,
        location: oneHeader(res.headers.location),
        discard: () => { res.resume(); },
        bytes: () => new Promise<Uint8Array>((whole, no) => {
          failBody = no;
          const parts: Buffer[] = [];
          res.on("data", (chunk: Buffer) => { parts.push(chunk); });
          res.on("error", (e) => { no(thrownAs(e)); });
          res.on("end", () => {
            clearTimeout(timer);
            try { whole(unpacked(Buffer.concat(parts), oneHeader(res.headers["content-encoding"]))); }
            catch (e) { no(thrownAs(e)); }
          });
        }),
      });
    });
    req.end();
  });
}
