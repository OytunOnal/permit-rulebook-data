import { afterAll, describe, expect, it } from "vitest";
import { Agent, createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { pbkdf2 } from "node:crypto";
import type { AddressInfo, LookupFunction } from "node:net";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import {
  addressKind, afterAnswer, fetchSource, MOST_OF_AN_ADDRESS, type Resolver, shortAddress,
} from "../src/watch/fetch-source.js";
import { processingFailure, runWatch, type Watchlist } from "../src/watch/core.js";
import {
  hasControl, hasSteering, MOST_OF_A_CODE, MOST_OF_A_FAILURE, MOST_OF_A_PAGE_WORD,
  noteOfLength, PRINTABLE_WITHIN_SOURCE, printableWithin, saidByThrown,
} from "../src/watch/failure.js";
import { ask, MEASURED, MOST_OF_A_BODY, unpacked } from "../src/watch/request.js";

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
/** A page past the bound, before anything decides how it travels. */
const PAST_THE_BOUND = pageOf(MOST_OF_A_BODY + 1024 * 1024);
/** A body that unpacks past the bound, and is a few kilobytes on the wire. */
const OVER_THE_BOUND = gzipSync(PAST_THE_BOUND);
/** Exactly the bound, which is the largest page this watch still reads. */
const AT_THE_BOUND = PAST_THE_BOUND.subarray(0, MOST_OF_A_BODY);
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
  // of gzip stand for seventeen megabytes of page, which is the whole of why
  // the bound is read off the unpacked size as well as off the wire.
  if (path === "/too-big") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "gzip" });
    res.end(OVER_THE_BOUND);
    return;
  }
  // The same page past the bound, arriving as the bytes the wire carried: no
  // decoder sees this one, which is the shape a source takes by answering
  // un-encoded, and the shape it takes by naming an encoding this watch does
  // not know.
  if (path === "/too-big-plain") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAST_THE_BOUND);
    return;
  }
  if (path === "/too-big-unknown") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-encoding": "compress" });
    res.end(PAST_THE_BOUND);
    return;
  }
  // The bound itself, un-encoded: the largest body the gate lets by.
  if (path === "/at-the-bound") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(AT_THE_BOUND);
    return;
  }
  // A source that answers, and then does not finish: the headers are a real
  // answer and the page never arrives.
  if (path === "/cut-off") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": "4096" });
    // Flushed first, destroyed after: the client must SEE the answer before
    // the connection goes, or nothing answered at all.
    res.write(SENTENCE, () => { res.socket?.destroy(); });
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

  it("unpacks every encoding the header it actually sent asked for", async () => {
    /**
     * Read from the wire, not from the constant.
     *
     * That the asked-for list has an unpacking is a TYPE: `ENCODINGS_ASKED_FOR`
     * is `keyof typeof UNPACKINGS`, so that drift is a build failure and
     * round-tripping the constant proves it a second time at run time
     * (Spec review, 2026-09-24). What no type holds is the step between the
     * constant and the source: the header a source reads is whatever
     * `ASKING` put on the wire. So the list comes back from the fixture's own
     * view of the request, and each encoding in it is sent as a real body and
     * read back.
     */
    const packing: Record<string, (page: Buffer) => Buffer> = {
      gzip: gzipSync, deflate: deflateSync, br: brotliCompressSync,
    };
    // The request this reads has to be its own. Without this, a read that
    // failed before `ask` ever ran would kill the case on `asked.at(-1)!`
    // and say nothing about the header it came here to prove (Spec review,
    // 2026-09-24).
    const read = await fetchSource(`${fixtureOrigin}/`, "same-origin");
    expect(read.ok, read.ok ? "" : read.error).toBe(true);
    const sent = asked.at(-1)!.headers["accept-encoding"] ?? "";
    const askedFor = sent.split(",").map((one) => one.trim()).filter((one) => one.length > 0);
    expect(askedFor.length, "the request asked for no encoding at all").toBeGreaterThan(0);
    for (const encoding of askedFor) {
      const pack = packing[encoding];
      expect(pack, `${encoding} was asked for and this test cannot send it`).toBeTypeOf("function");
      const page = await unpacked(pack!(Buffer.from(SENTENCE)), encoding);
      expect(new TextDecoder().decode(page), `${encoding} was asked for and is not unpacked`).toBe(SENTENCE);
    }
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
  it("refuses a body that unpacks past the bound", async () => {
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
    // A page that INFLATES past the bound and a page that simply is past it
    // are two different facts about a source, and the sentence a curator
    // reads says which one this was (`request.ts`'s `pastTheBound`).
    expect(answer.error, "the refusal does not say where the bound was passed").toContain(MEASURED.unpacked);
  });

  /**
   * The bound over the other shape of body: the bytes as they arrive.
   *
   * A decoder is given `maxOutputLength` and refuses past it, so a compressed
   * body was bounded from the start. A body nothing decodes — answered
   * un-encoded, or under an encoding this watch cannot name and therefore
   * hands on untouched — reached `Buffer.concat` with nothing counting it
   * (Security review, 2026-09-24). Both shapes now pass the same bound.
   */
  for (const [what, path] of [
    ["un-encoded", "/too-big-plain"],
    ["under an encoding this watch does not know", "/too-big-unknown"],
  ] as const) {
    it(`refuses a body past the bound that arrives ${what}`, async () => {
      const answer = await fetchSource(`${fixtureOrigin}${path}`, "same-origin");
      expect(answer.ok, "a body larger than the bound was read").toBe(false);
      if (answer.ok) return;
      // The same reading the decoders give: the source answered, and the
      // answer was not a page — which is the same answer in three minutes.
      expect(answer.failure).toBe("refused-by-source");
      expect(answer.status, "the source's own answer went unreported").toBe(200);
      // Nothing of what the body said reaches the log line, the flag file or
      // the issue the flag becomes.
      expect(answer.error, "the failure carries the body's own words").not.toContain("authority");
      // And the other half of that sentence: this body was that big, rather
      // than a small one that inflated.
      expect(answer.error, "the refusal does not say where the bound was passed").toContain(MEASURED.onTheWire);
      expect(answer.error, "a body nothing decoded was called unpacked").not.toContain(MEASURED.unpacked);
    });
  }

  it("reads a body of exactly the bound, whole", async () => {
    // The gate is a bound and not a budget: the largest body it allows is the
    // bound itself, and the byte after it is the refusal above.
    const answer = await fetchSource(`${fixtureOrigin}/at-the-bound`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    expect(answer.body.byteLength, "the page came back short").toBe(MOST_OF_A_BODY);
  });

  it("reads a body that unpacks inside the bound, whole", async () => {
    const answer = await fetchSource(`${fixtureOrigin}/big`, "same-origin");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    expect(answer.body.byteLength, "the page came back short").toBe(A_BIG_PAGE.byteLength);
    expect(new TextDecoder().decode(answer.body.slice(0, SENTENCE.length))).toBe(SENTENCE);
  });

  /**
   * Every number in this case is measured, and the machine is named.
   *
   * Unpacking runs on libuv's thread pool — four threads unless the
   * environment says otherwise — and waits its turn there like anything else.
   * Filling the pool puts the budget's deadline between the last byte
   * arriving and the page existing, which is the one window a deadline
   * released on `end` leaves open.
   *
   * Measured 2026-09-24 on the builder's machine (Windows 11, 16 logical
   * cores, Node v24.20.0): four parallel `pbkdf2` of 400,000 sha512 rounds
   * free the pool at 257 ms, while the fixture's headers arrive at 16 ms and
   * its last byte at 17 ms behind that same held pool. A 150 ms budget
   * therefore falls between the body and the page, which is what this case
   * needs — and the whole case costs about a quarter of a second rather than
   * the 1,137 ms four rounds of 2,000,000 took.
   *
   * A slower machine (CI is `ubuntu-24.04`, 2 vCPU) makes the pool work take
   * LONGER, which widens the window rather than closing it; what it risks is
   * duration, so the timeout is explicit — 10 s, about forty times the
   * measurement above — and a runner that slow fails here by saying so.
   */
  it("does not let a body that unpacks slowly outlive the budget", async () => {
    const pool = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
    const busy = Array.from({ length: pool }, () => new Promise<void>((done) => {
      pbkdf2("hold the pool", "s36", 400_000, 64, "sha512", () => { done(); });
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
  }, 10_000);
});

/**
 * What this tier prints BESIDE a thrown thing's own words, at its longest.
 *
 * Its own and bounded already: a cause code inside its ` (…)`, which the
 * code's own bound holds, and `afterAnswer`'s `after HTTP ` with the status
 * the fixture answers before the throw. Named from that bound rather than
 * retyped, so the sentence and the number cannot drift apart (Standards
 * review, 2026-09-24).
 */
const OURS_BESIDE_THE_WORDS = " (".length + MOST_OF_A_CODE + ")".length + afterAnswer("", 302).length;

describe("s36 — a read that ends badly still says what the source said", () => {
  it("reports the answer's own status when the socket dies mid-body", async () => {
    /**
     * The source answered 200 and then stopped talking. `fetch-source`'s own
     * principle — where a refusal was DECIDED is not the source's business,
     * what the source said is (s34) — reaches this branch too: a read that
     * ends in a socket error after an answer reports that answer, exactly as
     * the branch beside it does for a refusal made at the connection.
     */
    const answer = await fetchSource(`${fixtureOrigin}/cut-off`, "same-origin");
    expect(answer.ok, "half a page was read as a page").toBe(false);
    if (answer.ok) return;
    expect(answer.status, "the source's own answer went unreported").toBe(200);
    // Nothing about the source said no; the reading simply did not happen.
    expect(answer.failure).toBe("transient");
    // And says so in the sentence, which is what travels into the log line,
    // the flag file and the issue that flag becomes.
    // The clause is named from the contract that builds it, not retyped:
    // the decision is that the answer comes first in the sentence and names
    // the status (`afterAnswer`).
    expect(answer.error.startsWith(afterAnswer("", 200)),
      "the sentence does not open with what the source answered").toBe(true);
  });

  it("bounds a thrown thing's own words, and still says the code and the answer", async () => {
    /**
     * A wrapper is not a bound.
     *
     * `request.ts` turns every socket failure into `fetch failed` with the
     * real error underneath as a cause, so what this branch prints is five
     * words most mornings. But the print is `String(e)` over whatever
     * arrived, and this file's own sentence says that text travels into the
     * log line, the flag file and the issue the flag becomes
     * (`failure.ts`). The bound is the browser tier's, one owner for both
     * tiers (`printableWithin`, asked for at the throw in `cdp.ts` and on the
     * browser tier's own return path in `browser.ts`).
     *
     * Driven through the resolver seam, which is where a throw misses the
     * wrapper: Node calls the lookup hook from inside `http.request` itself,
     * so a hook that throws throws the request (probed 2026-09-24,
     * v24.20.0). The hop is to a NAME, so there is a lookup at all — and the
     * 302 before it is an answer the sentence still owes the curator.
     */
    const throwing: Resolver = () => {
      throw Object.assign(new Error("B".repeat(10_000)), { cause: { code: "ECONNRESET" } });
    };
    const answer = await fetchSource(`${fixtureOrigin}/to-name`, "anywhere", throwing);
    expect(answer.ok, "a throw inside the lookup was read as a page").toBe(false);
    if (answer.ok) return;
    expect(answer.error.length, "ten thousand characters of a thrown message reached the log line")
      .toBeLessThanOrEqual(MOST_OF_A_FAILURE + OURS_BESIDE_THE_WORDS);
    expect(answer.error, "the thrown message travelled whole").not.toContain("B".repeat(MOST_OF_A_FAILURE));
    // The two facts a curator acts on survive the cut.
    expect(answer.error, "the cause's code was cut away with the message").toContain("ECONNRESET");
    expect(answer.error.startsWith(afterAnswer("", 302)),
      "the sentence does not open with what the source answered before the throw").toBe(true);
    expect(answer.status, "the source's own answer went unreported").toBe(302);
  });

  it("makes a thrown thing's own words one printable line, and still says the code and the answer", async () => {
    /**
     * The bound cut LENGTH, and length was never the whole of the rule.
     *
     * Two hundred characters of somebody else's string still carried
     * whatever bytes were inside them: the newline that ends a line, the
     * carriage return that rewrites the one already printed, the escape a
     * terminal obeys, the override that reorders what is printed after it.
     * The log line survives them because it is a JSON field and escapes them
     * there. The flag file and the issue that flag becomes do not — the
     * issue is a Markdown body, where a newline ends the paragraph and the
     * rest of the sentence leaves the sentence (`failure.ts`'s opening
     * sentence; Security review, 2026-09-24).
     *
     * So the owner that cuts the length also makes the sentence printable,
     * and one owner is the whole point: the same rule at the fetcher's throw
     * and at the browser tier's. This asks it of the sentence a curator
     * actually reads, through the same resolver seam as the bound above.
     */
    const throwing: Resolver = () => {
      throw Object.assign(
        new Error("the source said no\r\n  at [31mgetaddrinfo[0m\n\tand again‮​"),
        { cause: { code: "ENOTFOUND" } },
      );
    };
    const answer = await fetchSource(`${fixtureOrigin}/to-name`, "anywhere", throwing);
    expect(answer.ok, "a throw inside the lookup was read as a page").toBe(false);
    if (answer.ok) return;
    // One line. Nothing that ends a line, moves a cursor, or reorders what is
    // printed after it reaches any of the three places this sentence travels.
    expect(answer.error, "the sentence is still more than one line").not.toMatch(/[\r\n]/);
    expect(hasControl(answer.error), "a byte a terminal acts on travelled with the words")
      .toBe(false);
    expect(hasSteering(answer.error), "a character that prints nothing travelled with the words")
      .toBe(false);
    // The words themselves are still the source's own, not a rewriting of
    // them: what was said survives, only the bytes nobody reads are gone.
    expect(answer.error, "the thrown thing's own words were thrown away with the bytes")
      .toContain("the source said no");
    expect(answer.error.length, "the printable sentence is past the bound")
      .toBeLessThanOrEqual(MOST_OF_A_FAILURE + OURS_BESIDE_THE_WORDS);
    // And the two facts a curator acts on survive being made printable.
    expect(answer.error, "the cause's code was lost with the bytes").toContain("ENOTFOUND");
    expect(answer.error.startsWith(afterAnswer("", 302)),
      "the sentence does not open with what the source answered before the throw").toBe(true);
  });

  it("says what a thrown thing said, and not the name of the class that said it", () => {
    // `String(e)` on an `Error` is "Error: " and then the message. That
    // prefix names the shape of an object in a runtime nobody reading the
    // morning's issue is looking at, and the browser tier has printed the
    // message alone since s34 — until s36 moved the bound onto that branch
    // and brought a `String(e)` with it (Spec review, 2026-09-24). Both of
    // that tier's printers ask this one function; the reader's own no-Chrome
    // case proves the branch a test can drive (`tests/s34-browser.test.ts`).
    expect(saidByThrown(new Error("Chrome closed the connection")),
      "the sentence carries the name of the class that threw")
      .toBe("Chrome closed the connection");
    expect(saidByThrown(new TypeError("fetch failed")), "a subclass names itself in the sentence")
      .toBe("fetch failed");
    // A thrower may throw anything, and a string is already what it said.
    expect(saidByThrown("the page refused"), "a thrown string was not printed as itself")
      .toBe("the page refused");
    // And the whole expression the browser reader's other branch prints, as
    // it is written there: cut, made printable, and still the message alone
    // (`browser.ts`). It is pinned HERE and not through the reader because
    // that branch cannot be driven from a test. Two things produce a plain
    // `Error` on it — a CDP protocol error and a socket that closes with a
    // command in flight (`cdp.ts`) — and neither is reachable through a real
    // Chrome from here: measured 2026-09-24, closing the reader four seconds
    // into a twenty-second read did not reject the command in flight (Chrome
    // is killed with the socket, so the close never completes and the
    // listener that rejects them never runs); the read ended 16.3 s later on
    // its own budget, which is a `ReadFailure` and the other branch. So the
    // honest pin is the expression, and the gap is named rather than
    // pretended away (Spec review, 2026-09-24).
    const chromeWentAway = new Error("Chrome closed the connection");
    expect(printableWithin(saidByThrown(chromeWentAway), MOST_OF_A_FAILURE),
      "the reader's own branch prints the name of a class, or more than the bound")
      .toBe("Chrome closed the connection");
  });

  it("bounds and prints the words of a page it could not process", () => {
    // The third place a thrown thing becomes a printed sentence, beside the
    // two catches this delta made honest — and the last one still handing
    // `String(e)` straight to the log line, the flag file and the issue that
    // flag becomes (the human's word, 2026-09-24).
    const thrown = new Error(`the marker is gone\u202e\n  at ${"x".repeat(10_000)}`);
    const said = processingFailure(thrown);
    expect(said, "the sentence is more than one line").not.toMatch(/[\r\n]/);
    expect(hasControl(said), "a byte a terminal acts on travelled with the words")
      .toBe(false);
    expect(hasSteering(said), "a character that prints nothing travelled with the words")
      .toBe(false);
    expect(said.length, "the thrown thing decided how long a log line is")
      .toBeLessThanOrEqual(MOST_OF_A_FAILURE + "processing: ".length);
    // The curator still learns which stage failed, and what it said.
    expect(said.startsWith("processing: "), "the sentence does not say which stage failed").toBe(true);
    expect(said, "the thrown thing's own words were thrown away with the bytes")
      .toContain("the marker is gone");
    // And the sentence a mangled page has produced since s11 is unchanged.
    expect(processingFailure(new Error("slice marker missing: from")),
      "an ordinary processing failure now reads differently")
      .toBe("processing: Error: slice marker missing: from");
  });
});

describe("s36 — one oversize body does not take the pass with it", () => {
  /**
   * The regression this guards is the PASS dying, not the read failing: one
   * source answering seventeen megabytes used to be able to spend the
   * runner's memory before any report was written, and the forty-five
   * entries behind it were never asked. So it is proved where that would
   * show — through `runWatch`, with a source behind the oversize one.
   *
   * Both shapes, because they are two refusals and either one can take the
   * pass: the count on the wire and the decoder's own `maxOutputLength`.
   * Proving one and not the other leaves a decoder refusal free to kill a
   * pass with nothing failing (Spec review, 2026-09-24).
   */
  for (const [shape, id, path] of [
    [MEASURED.onTheWire, "s36-over-the-bound", "/too-big-plain"],
    [MEASURED.unpacked, "s36-over-the-bound-encoded", "/too-big"],
  ] as const) {
    it(`reports a source past the bound ${shape} unreachable and reads the source after it`, async () => {
      const watchlist: Watchlist = {
        entries: [
          { id, url: `${fixtureOrigin}${path}`, strategy: "html", kind: "sentinel" },
          { id: "s36-behind-it", url: `${fixtureOrigin}/`, strategy: "html", kind: "sentinel" },
        ],
      };
      const { reports, nextState } = await runWatch(watchlist, { entries: {} }, fetchSource, "2026-09-24");
      const over = reports.find((report) => report.id === id)!;
      expect(over.outcome, "an oversize body was read as a page").toBe("unreachable");
      expect(over.failure, "the oversize body is worth asking about again").toBe("refused-by-source");
      // What the source answered reaches the report a curator reads. The
      // fetcher's `status` field stops at the report's door (`core.ts`), so
      // the sentence is where it has to be said — as the redirect refusals
      // say it — and it says which bound was passed.
      expect(over.error, "the report does not say what the source answered").toContain("HTTP 200");
      expect(over.error, "the report does not say where the bound was passed").toContain(shape);
      expect(over.error, "the report carries the body's own words").not.toContain("authority");
      // The source behind it was asked, read, and written down.
      const behind = reports.find((report) => report.id === "s36-behind-it")!;
      expect(behind.outcome, behind.error).toBe("baseline");
      expect(nextState.entries["s36-behind-it"], "the pass wrote no snapshot for it").toBeDefined();
    });
  }
});

describe("s36 — the sanitiser is the whole set, and it cuts on characters", () => {
  /**
   * Both halves of `printableWithin` are a security invariant, and both had a
   * hole the delta rounds had reported closed and had not closed (Security
   * review, 2026-09-24).
   *
   * The set: U+061C ARABIC LETTER MARK is one of Unicode's twelve
   * `Bidi_Control` code points, and the only one outside the ranges this rule
   * was spelled with — `\s` does not match it and the control ranges do not
   * reach it — so a character that reorders what is printed after it
   * travelled into the log line, the flag file and the issue that flag
   * becomes.
   *
   * The cut: it was made on UTF-16 units. A page whose words are astral — an
   * emoji, a CJK extension character — could be cut through the middle of one
   * and printed as a lone surrogate: a string a JSON line escapes as a bare
   * `\udXXX` and a Markdown body renders as a replacement character.
   */

  /** ES2024's own answer, which this repository's `lib` (ES2022) does not type. */
  const wellFormed = (text: string) => (text as unknown as { isWellFormed(): boolean }).isWellFormed();

  /** Unicode's `Bidi_Control` property, all twelve of it. */
  const BIDI_CONTROLS = [
    "؜", "‎", "‏", "‪", "‫", "‬",
    "‭", "‮", "⁦", "⁧", "⁨", "⁩",
  ];

  it("drops every character that steers a reader, the Arabic letter mark among them", () => {
    for (const steering of BIDI_CONTROLS) {
      expect(hasSteering(steering), "the rule does not know this character steers").toBe(true);
      expect(
        hasSteering(printableWithin(`the page said no${steering} and then this`, MOST_OF_A_FAILURE)),
        "a character that prints nothing travelled with the page's words",
      ).toBe(false);
    }
    // Dropped and not collapsed: a steering character has no width, and a
    // space where one stood would break a word the source did not break.
    expect(
      printableWithin("the page said no؜ and then this", MOST_OF_A_FAILURE),
      "a character with no width was printed as a space",
    ).toBe("the page said no and then this");
  });

  /**
   * What the two-family spelling never reached. None of these is a bidi
   * control or a joiner, and every one of them prints nothing, in the order
   * they are listed: a soft hyphen, the combining grapheme joiner, the two
   * Hangul jamo fillers, a Khmer inherent vowel, the Mongolian vowel
   * separator, an unassigned ignorable, the Hangul filler, a variation
   * selector, the byte-order mark, the halfwidth Hangul filler, a tag
   * character. `\s` does not match a soft hyphen and the control class does
   * not reach one, so two labels that are not the same string rendered alike
   * in a sentence a curator reads (Security review, 2026-09-25).
   */
  const PRINTS_NOTHING = [
    "\u00ad", "\u034f", "\u115f", "\u1160", "\u17b4", "\u180e",
    "\u2065", "\u3164", "\ufe0f", "\ufeff", "\uffa0", "\u{e0061}",
  ];

  it("drops everything that prints nothing, and not only what steers", () => {
    for (const invisible of PRINTS_NOTHING) {
      const named = `U+${invisible.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
      expect(hasSteering(invisible), `the rule does not know ${named} prints nothing`).toBe(true);
      expect(
        printableWithin(`the page said no${invisible} and then this`, MOST_OF_A_FAILURE),
        `${named} travelled with the page's words`,
      ).toBe("the page said no and then this");
    }
  });

  it("keeps every character a reader can actually see", () => {
    // The widening is checkable in both directions: the class takes what
    // prints nothing, and nothing else. A combining accent, an astral
    // character and a letter outside Latin-1 all print.
    for (const printed of ["e\u0301", "\u{1f600}", "\u{2070e}", "\u03a9", "\u0130"]) {
      expect(hasSteering(printed), "the rule took a character a reader can see").toBe(false);
      expect(printableWithin(`said ${printed} here`, MOST_OF_A_FAILURE)).toBe(`said ${printed} here`);
    }
  });

  it("holds a bound smaller than the note it would print", () => {
    // Nothing says a bound must leave room for the note. Cutting at
    // `most - note.length` with a small `most` hands `slice` a negative
    // second argument, which counts from the END and keeps nearly the whole
    // string — the bound voided exactly where it is tightest (Security
    // review, 2026-09-25).
    for (const most of [0, 1, 5, noteOfLength(100).length - 1, noteOfLength(100).length]) {
      const said = printableWithin("x".repeat(100), most);
      expect([...said].length, `a bound of ${most} printed more than it allows`)
        .toBeLessThanOrEqual(most);
    }
  });

  it("cuts an address on characters too, and counts it in the same unit", () => {
    // `shortAddress` is the other place this package shortens something a
    // person reads, and the browser tier's request list reaches it
    // (`cdp.ts`). It cut UTF-16 units, so an address of astral characters
    // could end in half of one — a lone surrogate in the log line, the flag
    // file and the issue (Security review, 2026-09-25).
    const address = `https://rules.example.org/a${"\u{1f600}".repeat(300)}`;
    const note = noteOfLength([...address].length);
    const short = shortAddress(address);
    expect(wellFormed(short), "the cut ended inside a character and printed half of one").toBe(true);
    expect([...short].length, "the cut fell somewhere other than the bound")
      .toBe(MOST_OF_AN_ADDRESS + [...note].length);
    expect(short, "the note counts in a unit nobody reading it counts in").toContain(note);
  });

  it("cuts a page's astral words on characters, and counts them in the same unit", () => {
    // Five hundred emoji are a thousand UTF-16 units: a cut on units lands
    // inside one of them and emits half a character.
    const astral = "\u{1f600}".repeat(500);
    const said = printableWithin(astral, MOST_OF_A_FAILURE);
    expect(wellFormed(said), "the cut ended inside a character and printed half of one").toBe(true);
    expect([...said].length, "the sentence is past the bound in the unit the bound is measured in")
      .toBeLessThanOrEqual(MOST_OF_A_FAILURE);
    // The note counts what a person counts: characters, and not the units a
    // runtime happens to store them in. Five hundred of them arrived.
    expect(said, "the note counts in a unit nobody reading it counts in")
      .toContain(noteOfLength(500));
    // And a CJK extension character is the same fact in another script.
    const cjk = "\u{2070e}".repeat(500);
    const read = printableWithin(cjk, MOST_OF_A_FAILURE);
    expect(wellFormed(read), "the cut ended inside a character and printed half of one").toBe(true);
    expect(read, "the note counts in a unit nobody reading it counts in")
      .toContain(noteOfLength(500));
  });

  it("cuts the same way inside Chrome, because it is one rule and two runtimes", () => {
    // The half of the step vocabulary that runs inside the page cannot import
    // the rule, so it is handed it as source. Two spellings are how two
    // copies start disagreeing about where a sentence ends; this is the case
    // that goes red when they do (Standards review, 2026-09-24).
    const inChrome = new Function(`${PRINTABLE_WITHIN_SOURCE}\n  return printableWithin;`)() as
      (text: string, most: number) => string;
    const table: Array<[string, string, number]> = [
      ["a sentence short enough to read", "the page said no", MOST_OF_A_FAILURE],
      ["a sentence past the bound", "x".repeat(10_000), MOST_OF_A_FAILURE],
      ["a page's own word past its bound", "x".repeat(400), MOST_OF_A_PAGE_WORD],
      ["a word exactly at the bound", "x".repeat(MOST_OF_A_PAGE_WORD), MOST_OF_A_PAGE_WORD],
      ["a word one character past it", "x".repeat(MOST_OF_A_PAGE_WORD + 1), MOST_OF_A_PAGE_WORD],
      ["astral characters past the bound", "\u{1f600}".repeat(500), MOST_OF_A_FAILURE],
      ["every character that steers a reader", BIDI_CONTROLS.join("x"), MOST_OF_A_FAILURE],
      ["the bytes a terminal acts on", "a\r\n[31mb c", MOST_OF_A_FAILURE],
      ["a character that prints nothing but does not steer", `a${PRINTS_NOTHING.join("b")}c`, MOST_OF_A_FAILURE],
      ["a bound smaller than the note it would print", "x".repeat(100), 5],
    ];
    for (const [what, text, most] of table)
      expect(inChrome(text, most), `the two runtimes disagree about ${what}`)
        .toBe(printableWithin(text, most));
  });
});
