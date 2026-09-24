import { afterAll, describe, expect, it } from "vitest";
import { Agent, createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { pbkdf2 } from "node:crypto";
import type { AddressInfo, LookupFunction } from "node:net";
import { gzipSync } from "node:zlib";
import { addressKind, fetchSource, type Resolver } from "../src/watch/fetch-source.js";
import { ask, MOST_OF_A_BODY } from "../src/watch/request.js";

/**
 * s36 — the address the watch connects to.
 *
 * The floor read the address a source *spells*. Two classes sat outside it: a
 * name that resolves to a private or link-local address, and the transition
 * and legacy prefixes the classifier had never learnt. Both close the same
 * way — connect to the address you checked — and the mechanism is Node's own
 * `lookup` hook, which is handed the hostname and gives back the address the
 * socket will use.
 *
 * The hook is also the seam: the fetcher takes an optional resolver, so a test
 * can say what a name resolves to without owning a DNS server.
 */

/** Counted, because most of what this file proves is the absence of a request. */
const asked: { path: string; headers: IncomingHttpHeaders }[] = [];

/** One sentence of a page, repeated to whatever size a body needs. */
const SENTENCE = "<p>The authority's own words</p>";
function pageOf(bytes: number): Buffer {
  return Buffer.from(SENTENCE.repeat(Math.ceil(bytes / SENTENCE.length)));
}
/** A body that unpacks past the bound, and is a few kilobytes on the wire. */
const OVER_THE_BOUND = gzipSync(pageOf(MOST_OF_A_BODY + 1024 * 1024));
/** A page far larger than any the watch reads, and still inside the bound. */
const A_BIG_PAGE = pageOf(2 * 1024 * 1024);
const BIG_ZIPPED = gzipSync(A_BIG_PAGE);

const fixture: Server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0]!;
  asked.push({ path, headers: req.headers });
  // The four spellings s34's Security round probed and the floor let through.
  if (path === "/to-nat64") { res.writeHead(302, { location: "http://[64:ff9b::a9fe:a9fe]/latest/" }); res.end(); return; }
  if (path === "/to-6to4") { res.writeHead(302, { location: "http://[2002:a9fe:a9fe::1]/latest/" }); res.end(); return; }
  if (path === "/to-compat") { res.writeHead(302, { location: "http://[::a9fe:a9fe]/latest/" }); res.end(); return; }
  if (path === "/to-site-local") { res.writeHead(302, { location: "http://[fec0::1]/admin" }); res.end(); return; }
  // A hop to a NAME, which is the only way a resolver gets a word in: an entry
  // spelled as a literal never reaches the hook at all (Node skips a lookup
  // for an address it can already parse — probed 2026-09-24, v24.20.0).
  if (path === "/to-name") {
    res.writeHead(302, { location: `http://fixture.test:${(fixture.address() as AddressInfo).port}/settled` });
    res.end();
    return;
  }
  // A body that unpacks to more than any page the watch reads. Five kilobytes
  // of gzip stand for seventeen megabytes of page, which is the whole of why a
  // bound is read off the unpacked size and not off the wire.
  if (path === "/too-big") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
    res.end(OVER_THE_BOUND);
    return;
  }
  // A big page that is still a page.
  if (path === "/big") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
    res.end(BIG_ZIPPED);
    return;
  }
  // A source that answers gzipped, which is most of them: the watch asks for
  // gzip and hashes the page, not the compressed bytes.
  if (path === "/zipped") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
    res.end(gzipSync(Buffer.from("<p>The authority's own words</p>")));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<p>The authority's own words</p>");
});
await new Promise<void>((resolve) => { fixture.listen(0, "127.0.0.1", () => resolve()); });
const port = (fixture.address() as AddressInfo).port;
const fixtureOrigin = `http://127.0.0.1:${port}`;

afterAll(() => { fixture.close(); });

/** How many times the resolver below was asked anything. */
let resolutions = 0;

/**
 * A resolver that answers from a table.
 *
 * Each name's answer is a LIST of turns: the first call gets the first turn,
 * every call after it gets the last — which is how a resolver that changes its
 * mind between the check and the connect is written down.
 */
function answering(table: Record<string, string[][]>): Resolver {
  const turns: Record<string, number> = {};
  return (hostname, _options, done) => {
    resolutions += 1;
    const answers = table[hostname];
    if (!answers) { done(Object.assign(new Error("not in the table"), { code: "ENOTFOUND" }), []); return; }
    const turn = Math.min(turns[hostname] ?? 0, answers.length - 1);
    turns[hostname] = turn + 1;
    done(null, answers[turn]!.map((address) => ({
      address, family: address.includes(":") ? 6 : 4,
    })));
  };
}

describe("s36 — the floor spells the prefixes that carry another address", () => {
  /**
   * Four literals the classifier read as public because it had never learnt
   * them, each probed from a public entry in s34's Security round and each
   * requested. Three of them are 169.254.169.254 — where a hosted runner keeps
   * its credentials — wearing an IPv6 spelling.
   */
  for (const [what, literal, kind] of [
    ["NAT64 carrying the metadata address", "64:ff9b::a9fe:a9fe", "link-local"],
    ["6to4 carrying the metadata address", "2002:a9fe:a9fe::1", "link-local"],
    ["the compat form of the metadata address", "::a9fe:a9fe", "link-local"],
    ["NAT64 carrying a private address", "64:ff9b::a00:5", "private"],
    ["6to4 carrying a private address", "2002:a00:5::1", "private"],
    ["the compat form of a loopback address", "::7f00:1", "loopback"],
    ["site-local", "fec0::1", "private"],
    ["site-local at the top of its range", "feff::1", "private"],
    // And the rule stays a rule about what an address IS: a prefix that
    // carries a public address is public, not refused by association.
    ["NAT64 carrying a public address", "64:ff9b::5db8:d822", "public"],
    ["6to4 carrying a public address", "2002:5db8:d822::1", "public"],
    ["an ordinary public IPv6 address", "2001:4860:4860::8888", "public"],
  ] as const) {
    it(`reads ${what} as ${kind}`, () => {
      expect(addressKind(literal)).toBe(kind);
    });
  }

  for (const [what, path, kind] of [
    ["a NAT64 address", "/to-nat64", "link-local"],
    ["a 6to4 address", "/to-6to4", "link-local"],
    ["a compat address", "/to-compat", "link-local"],
    ["a site-local address", "/to-site-local", "private"],
  ] as const) {
    it(`refuses a redirect to ${what}, before it is taken`, async () => {
      const before = asked.length;
      const answer = await fetchSource(`${fixtureOrigin}${path}`, "anywhere");
      expect(answer.ok, `${what} was followed`).toBe(false);
      if (answer.ok) return;
      // The source's own answer, which is what a refusal made from the
      // `location` header can report and a failed connection cannot.
      expect(answer.status, "the refusal came from somewhere other than the header").toBe(302);
      expect(answer.failure).toBe("refused-by-us");
      expect(answer.error, "the refusal does not say what kind of address it is").toContain(kind);
      // One request: the entry's. The refused address was never asked.
      expect(asked.length - before, "more than the entry was requested").toBe(1);
    });
  }

  /**
   * The same rule where a chain STARTS. An entry is a url a curator typed and
   * still an address (scenario point 4), and the one kind the relative rule
   * can refuse about a starting point is a link-local one — an entry is by
   * definition already on its own kind, which is what keeps the loopback
   * fixture above readable.
   */
  for (const [what, host] of [
    ["the metadata address", "169.254.169.254"],
    ["a NAT64 address carrying it", "[64:ff9b::a9fe:a9fe]"],
  ] as const) {
    it(`refuses an ENTRY spelled as ${what}, and asks it for nothing`, async () => {
      const before = asked.length;
      const answer = await fetchSource(`http://${host}:${port}/`, "same-origin");
      expect(answer.ok, "a link-local entry was read").toBe(false);
      if (answer.ok) return;
      expect(answer.failure).toBe("refused-by-us");
      expect(answer.error, "the refusal does not say what kind of address it is").toContain("link-local");
      expect(answer.error, "the address was printed").not.toContain("a9fe");
      expect(asked.length - before, "something was requested").toBe(0);
    });
  }

  it("still reads an entry that IS on loopback, which is the relative rule", async () => {
    // The refusal above is not a wider rule than the floor's: an entry on its
    // own kind stays readable, and the fixture is the case that says so.
    const answer = await fetchSource(`${fixtureOrigin}/`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
  });
});

describe("s36 — a name is refused by what it resolves to", () => {
  it("refuses an entry whose name resolves to a private address, and asks it for nothing", async () => {
    const before = asked.length;
    const answer = await fetchSource(
      `http://mirror.test:${port}/`, "same-origin",
      // The second turn is the fixture's own address: a reader that resolved
      // once to decide and let the socket resolve again would land on it, and
      // the count below would not be zero.
      answering({ "mirror.test": [["10.0.0.5"], ["127.0.0.1"]] }),
    );
    expect(answer.ok, "a name pointed at the private network was read").toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("refused-by-us");
    expect(answer.error, "the refusal does not say what kind of address it is").toContain("private");
    expect(answer.error, "the address behind the name was printed").not.toContain("10.0.0.5");
    // Nothing answered, so there is nothing of the source's to report.
    expect(answer.status, "a source that never answered was given a status").toBeUndefined();
    expect(asked.length - before, "something was requested").toBe(0);
  });

  it("refuses an entry whose name resolves to the metadata address", async () => {
    const before = asked.length;
    const answer = await fetchSource(
      `http://runner.test:${port}/`, "same-origin",
      answering({ "runner.test": [["169.254.169.254"]] }),
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("refused-by-us");
    expect(answer.error, "the refusal does not say what kind of address it is").toContain("link-local");
    expect(answer.error).not.toContain("169.254.169.254");
    expect(asked.length - before).toBe(0);
  });

  it("refuses a name when ANY of its addresses is refused", async () => {
    // A resolver answers a list, and a reader that took the first allowed one
    // would connect wherever the list's author liked on the next answer.
    const before = asked.length;
    const startedAt = resolutions;
    const answer = await fetchSource(
      `http://both.test:${port}/`, "same-origin",
      answering({ "both.test": [["93.184.216.34", "10.0.0.5"]] }),
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("refused-by-us");
    expect(answer.error).toContain("private");
    expect(asked.length - before).toBe(0);
    // A refusal is a decision and not a connection that failed. The public
    // address in that list was never dialled, and the difference is readable
    // without a stopwatch: a dial that goes nowhere comes back as a wrapped
    // socket error, `transient`, worth one more read. This one names a kind of
    // address, is ours, and reddens the morning it happens.
    expect(answer.error, "the refusal reads as a socket that gave up").not.toContain("fetch failed");
    // One answer, judged. A reader that dialled would have had to ask again.
    expect(resolutions - startedAt, "the name was resolved more than once").toBe(1);
  });

  it("still reads a name that resolves where its entry already is", async () => {
    // The rule is relative, and stays relative after resolving: this entry is
    // on loopback, so a hop to a name that resolves to loopback is the
    // ordinary case and must work.
    const before = asked.length;
    const startedAt = resolutions;
    const answer = await fetchSource(
      `${fixtureOrigin}/to-name`, "anywhere",
      // The check's answer and the connection's answer are the same answer —
      // so a second, different one is never asked for. A reader that resolved
      // to decide and let the socket resolve again would connect to 10.0.0.5
      // and read nothing.
      answering({ "fixture.test": [["127.0.0.1"], ["10.0.0.5"]] }),
    );
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    expect(new TextDecoder().decode(answer.body)).toContain("The authority's own words");
    expect(answer.from, "the reading does not say where it moved to").toContain("fixture.test");
    // The entry and the hop: two requests, and the second arrived at the
    // address the resolver gave on the call that was judged.
    expect(asked.length - before, "the hop did not reach the address that was checked").toBe(2);
    expect(resolutions - startedAt, "the name was resolved more than once").toBe(1);
  });

  it("refuses the same hop when the first answer is the refused one", async () => {
    const before = asked.length;
    const answer = await fetchSource(
      `${fixtureOrigin}/to-name`, "anywhere",
      answering({ "fixture.test": [["10.0.0.5"], ["127.0.0.1"]] }),
    );
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("refused-by-us");
    expect(answer.error).toContain("private");
    // The source's own answer, reported whichever way the hop was refused:
    // read off the `location` header, or made at the connection. s34 pinned
    // that a report says what the source said, and where the refusal was
    // decided is not the source's business.
    expect(answer.status, "the source's own answer went unreported").toBe(302);
    // The entry, and nothing after it.
    expect(asked.length - before, "the hop was taken anyway").toBe(1);
  });
});

describe("s36 — what the watch reads does not change", () => {
  it("asks with the name and the contact header, and nothing of its own besides", async () => {
    const answer = await fetchSource(`${fixtureOrigin}/`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    const sent = asked.at(-1)!.headers;
    // The name that got `inclusion.gob.es` to answer, and the address beside
    // it rather than inside it (data #18).
    expect(sent["user-agent"]).toBe("permit-rulebook-watch/0.1");
    expect(sent["x-source-contact"]).toBe("https://github.com/OytunOnal/permit-rulebook-data");
    // Nothing that would make this a different client to a bot wall.
    expect(sent.cookie).toBeUndefined();
    expect(sent.authorization).toBeUndefined();
  });

  it("asks for the encodings it can read, and reads a source that sends one", async () => {
    // Measured 2026-09-24 against this repository's Node (v24.20.0): the
    // `fetch` this tier used sent `accept-encoding: gzip, deflate` and handed
    // back the page decompressed. Sources answer gzipped because of that
    // header, so it travels with the request and the body is unpacked here.
    const answer = await fetchSource(`${fixtureOrigin}/zipped`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    const sent = asked.at(-1)!.headers["accept-encoding"] ?? "";
    expect(sent, "gzip is no longer asked for").toContain("gzip");
    expect(sent, "deflate is no longer asked for").toContain("deflate");
    // The bytes that become a fingerprint are the page's, not the zipped
    // stream's — otherwise every source that varies its compression would
    // read as changed every morning.
    expect(new TextDecoder().decode(answer.body)).toBe("<p>The authority's own words</p>");
  });
});

/**
 * A lookup hook that answers nothing, for a request to a literal address.
 *
 * Node resolves nothing for an address it can already parse (probed
 * 2026-09-24, v24.20.0), so a request to the fixture never reaches this — and
 * if one ever did, the test would say so rather than quietly dial something.
 */
const noLookup: LookupFunction = (hostname, _options, done) => {
  done(Object.assign(new Error(`${hostname} was resolved`), { code: "ENOTFOUND" }), "", 4);
};

describe("s36 — a body is unpacked under a bound and inside the budget", () => {
  it("refuses a body that unpacks past the bound, and reads the next source anyway", async () => {
    const answer = await fetchSource(`${fixtureOrigin}/too-big`, "same-origin");
    expect(answer.ok, "a body larger than the bound was read").toBe(false);
    if (answer.ok) return;
    // The source answered, and the answer was not a page. That is the same
    // answer in three minutes, so it is not asked again (`failure.ts`).
    expect(answer.failure).toBe("refused-by-source");
    // The source answered 200 and what came back was not a page: both halves
    // of that belong in the report.
    expect(answer.status, "the source's own answer went unreported").toBe(200);
    // Nothing of what the body said reaches the log line, the flag file or the
    // issue the flag becomes.
    expect(answer.error, "the failure carries the body's own words").not.toContain("authority");
    // A refusal, not a crash: the pass goes on to the source after it.
    const next = await fetchSource(`${fixtureOrigin}/`, "same-origin");
    expect(next.ok, next.ok ? "" : next.error).toBe(true);
  });

  it("reads a body that unpacks inside the bound, whole", async () => {
    const answer = await fetchSource(`${fixtureOrigin}/big`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    expect(answer.body.byteLength, "the page came back short").toBe(A_BIG_PAGE.byteLength);
    expect(new TextDecoder().decode(answer.body.slice(0, SENTENCE.length))).toBe(SENTENCE);
  });

  it("does not let a body that unpacks slowly outlive the budget", async () => {
    /**
     * Unpacking runs on libuv's thread pool — four threads unless the
     * environment says otherwise — and waits its turn there like anything
     * else. Filling the pool with work that takes about a second puts the
     * budget's deadline between the last byte arriving and the page existing,
     * which is the one window a deadline released on `end` leaves open.
     */
    const pool = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
    const busy = Array.from({ length: pool }, () => new Promise<void>((done) => {
      pbkdf2("hold the pool", "s36", 2_000_000, 64, "sha512", () => { done(); });
    }));
    const agent = new Agent();
    try {
      const answer = await ask(new URL(`${fixtureOrigin}/big`), {
        headers: { "accept-encoding": "gzip" },
        lookup: noLookup,
        agent,
        msLeft: 150,
      });
      // The headers arrived inside the budget; the bytes are what is at stake.
      expect(answer.status).toBe(200);
      await expect(answer.bytes(), "the page outlived the budget that was asked for it")
        .rejects.toThrow("The operation was aborted due to timeout");
    } finally {
      agent.destroy();
      await Promise.all(busy);
    }
  });
});
