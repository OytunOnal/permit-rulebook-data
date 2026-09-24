import { request as httpRequest, type Agent, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { brotliDecompress, gunzip, inflate, inflateRaw } from "node:zlib";
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
 * `DOMException` whose text is Node's own — and that text travels everywhere
 * `failure.ts`'s opening sentence says an error travels. The move off `fetch`
 * is a change of mechanism and not a change of what a curator reads.
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
 * (`connect ECONNREFUSED 10.0.0.5:443`), and where a failure's text ends up is
 * `failure.ts`'s opening sentence.
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
 * The most a body may become once it is unpacked.
 *
 * A compressed body is small on the wire and whatever it likes in memory:
 * five kilobytes of gzip is seventeen megabytes of page, and zlib's own
 * default is `buffer.kMaxLength` — about 4 GiB — which a run on a hosted
 * runner does not survive. So every unpacking below is given this bound, and
 * a body that passes it is a failed read rather than a dead pass.
 *
 * Sixteen mebibytes is measured, not chosen. The whole watchlist was read on
 * 2026-09-24 with this watch's own headers — 42 of the 44 addressable entries
 * answered — and the largest body, decompressed, was 1,040,895 bytes
 * (`boe-rd-1155-2024`, Spain's consolidated BOE text); the `inclusion.gob.es`
 * PDF was second at 701,825. This is sixteen times the largest of them and
 * 256 times smaller than zlib's default: a source may grow its page by an
 * order of magnitude and still be read, and no source can spend the runner's
 * memory.
 */
export const MOST_OF_A_BODY = 16 * 1024 * 1024;

/**
 * The encodings a request asks for, spelled as the header that asks for them.
 *
 * `ASKING` in `fetch-source.ts` sends this verbatim, and `unpacked` below
 * reads every encoding named in it — so what is asked for cannot drift away
 * from what can be read, which is the failure mode of writing them twice: a
 * source is sent an encoding this file cannot unpack, and the watch
 * fingerprints a compressed stream. What `unpacked` reads BEYOND it is `br`,
 * for a server that sends it unasked; that direction is safe and is written
 * down there.
 */
export const ENCODINGS_ASKED_FOR = "gzip, deflate";

/** Every unpacking zlib offers this file, narrowed to the one way it is called. */
type Unpacking = (
  input: Buffer,
  options: { maxOutputLength: number },
  done: (error: Error | null, output: Buffer) => void,
) => void;

/**
 * The failure a body past the bound is, and the class it deserves.
 *
 * **refused-by-source**, not transient: the source answered, and the answer
 * was not a page — which is the same answer in three minutes, so it is not
 * asked again (`failure.ts`). Nor `refused-by-us`: nothing about this runner
 * declined to make the request, and a curator reading it needs to look at the
 * source rather than at us.
 *
 * The sentence names the bound, which is ours, and nothing of the body, which
 * is the source's — `failure.ts`'s opening sentence.
 */
function pastTheBound(): ReadFailure {
  return new ReadFailure(
    `the body unpacks to more than ${MOST_OF_A_BODY} bytes, which is no page this watch reads`,
    "refused-by-source",
  );
}

/**
 * One unpacking, bounded, off the event loop.
 *
 * Asynchronous and not `…Sync`: unpacking runs on libuv's thread pool, so a
 * large body does not stop the run while it inflates — and, because it is
 * work that happens after the last byte arrives, the request's own deadline
 * has to still be running when it does (`ask` below).
 */
function unpacking(how: Unpacking, bytes: Buffer): Promise<Uint8Array> {
  return new Promise((whole, no) => {
    how(bytes, { maxOutputLength: MOST_OF_A_BODY }, (error, output) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        no(code === "ERR_BUFFER_TOO_LARGE" ? pastTheBound() : error);
        return;
      }
      whole(new Uint8Array(output));
    });
  });
}

/**
 * The body as the page wrote it, not as the wire carried it.
 *
 * `fetch` did this invisibly, and it matters more than it looks: the watch
 * fingerprints these bytes, so a source that compresses differently from one
 * morning to the next would read as changed every day if the compressed
 * stream were what got hashed.
 *
 * Only what the request asked for is unpacked (`ENCODINGS_ASKED_FOR`, measured
 * from what `fetch` sent), plus `br` for a server that sends it unasked.
 * `deflate` has two spellings in the wild — zlib-wrapped, as the RFC says, and
 * raw — and the second is tried when the first fails, which is what every
 * browser does. Anything else is left exactly as it arrived, which is what
 * `fetch` did with an encoding it had not asked for.
 */
export function unpacked(bytes: Buffer, encoding: string | null): Promise<Uint8Array> {
  if (bytes.byteLength === 0) return Promise.resolve(new Uint8Array(0));
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "gzip": case "x-gzip": return unpacking(gunzip, bytes);
    case "br": return unpacking(brotliDecompress, bytes);
    case "deflate":
      // The other spelling is tried only when THIS one is what failed. A body
      // that passed the bound passed it in either spelling, and inflating it a
      // second time to learn that is the bound paid for twice.
      return unpacking(inflate, bytes).catch((e: unknown) => {
        if (e instanceof ReadFailure) throw e;
        return unpacking(inflateRaw, bytes);
      });
    default: return Promise.resolve(new Uint8Array(bytes));
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

    let answered = false;
    /** Where a failure goes once the answer is somebody else's to read. */
    let failBody: ((e: unknown) => void) | null = null;
    /** Whether a body is still becoming a page — work the budget covers. */
    let reading = false;

    /**
     * The budget, enforced on the socket rather than on a signal.
     *
     * One deadline per SOURCE is computed by the caller; what arrives here is
     * what is left of it, and it covers everything that turns an answer into a
     * page: the headers, the body's arrival, and the unpacking. A source that
     * answers in a millisecond and then dribbles the page for a minute is the
     * case a header-only deadline misses; a body waiting its turn on the
     * thread pool to be unpacked is the case a deadline released on `end`
     * misses, and a destroyed socket cannot report that one — so the timer
     * fails the body directly as well (Security review, 2026-09-24).
     *
     * It is released in exactly the three places where nothing is left to
     * bound: on the request's `close` when no body is being read, on a failure
     * that ends the request before it is answered, and where the unpacked page
     * is handed over. `close` is late enough to be one of them — measured
     * 2026-09-24 against a fixture that held its last chunk back 700 ms, the
     * order is `data` … `end` (716 ms) then `close` (716 ms) — and it fires
     * for certain, which is what keeps a 30 s timer from holding a finished
     * run open.
     */
    const timer = setTimeout(() => {
      req.destroy(budgetSpent());
      failBody?.(budgetSpent());
    }, Math.max(0, asking.msLeft));

    req.on("close", () => { if (!reading) clearTimeout(timer); });
    req.on("error", (e) => {
      const why = thrownAs(e);
      if (!answered) { answered = true; clearTimeout(timer); reject(why); return; }
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
          reading = true;
          /** The budget's last stop: the page exists, or it never will. */
          const over = () => { reading = false; clearTimeout(timer); };
          const gave = (body: Uint8Array) => { over(); whole(body); };
          const failed = (e: unknown) => { over(); no(e); };
          failBody = failed;
          const parts: Buffer[] = [];
          /**
           * What has arrived, so that the bound is one rule over both shapes
           * of body.
           *
           * A decoder is handed `maxOutputLength` and refuses past it, so a
           * compressed body was bounded the moment it was named. A body
           * nothing decodes — answered un-encoded, or under an encoding this
           * file cannot name and therefore hands on as it arrived — used to
           * reach `Buffer.concat` with nothing counting it: a source could
           * push whatever it managed inside the budget and the run wore the
           * cost twice, once in `parts` and once in the concatenation
           * (Security review, 2026-09-24).
           *
           * Counted on the wire, which is never larger than the page it
           * becomes: a body already past the bound compressed is past it
           * unpacked too, so the gate is a floor under the decoders rather
           * than a second opinion about them. The cost is an addition and a
           * comparison per chunk.
           *
           * The socket is destroyed rather than read to its end: a source
           * that answers a bound with more bytes is not owed the rest of the
           * conversation.
           */
          let arrived = 0;
          res.on("data", (chunk: Buffer) => {
            arrived += chunk.byteLength;
            if (arrived > MOST_OF_A_BODY) {
              parts.length = 0;
              failed(pastTheBound());
              req.destroy();
              return;
            }
            parts.push(chunk);
          });
          res.on("error", (e) => { failed(thrownAs(e)); });
          res.on("end", () => {
            unpacked(Buffer.concat(parts), oneHeader(res.headers["content-encoding"]))
              .then(gave, (e: unknown) => { failed(thrownAs(e)); });
          });
        }),
      });
    });
    req.end();
  });
}
