import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  addressKind, fetchSource, MOST_OF_AN_ADDRESS, refusedTarget, shortAddress,
} from "../src/watch/fetch-source.js";
import { classOfThrown, noteOfLength } from "../src/watch/failure.js";

/**
 * s34 — the fetch tier follows a redirect around a site, and not off it.
 *
 * The browser reader was closed against a source that navigates to a third
 * party on 2026-09-24, and this is the same harm one tier over: `redirect:
 * "follow"` is right for the journey a source makes within its own host — a
 * trailing slash, a cookie check, a language prefix — and wrong the moment it
 * leaves, because a third party's bytes are then hashed as the authority's,
 * checked against the quotes, and filed in an issue under the authority's
 * name.
 *
 * The fetcher lived as a closure inside `cli-watch.ts` until this round, which
 * is why nothing here could be asked of it before.
 */

/** Counted, because the point is that it is never asked. */
let elsewhereAsked = 0;
/** Counted too: a loop is asked for a bounded number of times. */
let sourceAsked = 0;
const elsewhere: Server = createServer((_req, res) => {
  elsewhereAsked += 1;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<p>Somewhere else entirely</p>");
});
await new Promise<void>((resolve) => { elsewhere.listen(0, "127.0.0.1", () => resolve()); });
const elsewhereOrigin = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;

/**
 * A source that moves: `/away` leaves the site, `/around` goes to `/settled`
 * on the way to the same page, and `/` is the page.
 */
const source: Server = createServer((req, res) => {
  sourceAsked += 1;
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/away") { res.writeHead(302, { location: `${elsewhereOrigin}/x` }); res.end(); return; }
  // The shape anabin.kmk.org actually has: https answered with a 301 to plain
  // http on the same host. Same host, different scheme, so a different origin.
  if (path === "/downgrade") {
    res.writeHead(301, { location: `${sourceOrigin.replace("http://", "https://")}/settled` });
    res.end();
    return;
  }
  if (path === "/around") { res.writeHead(302, { location: "/settled" }); res.end(); return; }
  if (path === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
  if (path === "/to-data") { res.writeHead(302, { location: "data:text/html,<p>inline</p>" }); res.end(); return; }
  if (path === "/to-file") { res.writeHead(302, { location: "file:///etc/passwd" }); res.end(); return; }
  if (path === "/to-metadata") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); res.end(); return; }
  if (path === "/to-private") { res.writeHead(302, { location: "http://10.0.0.1/admin" }); res.end(); return; }
  if (path === "/long") {
    res.writeHead(302, { location: `${elsewhereOrigin}/${"a".repeat(9_000)}` });
    res.end();
    return;
  }
  if (path === "/longway") { res.writeHead(302, { location: `/settled?${"b".repeat(12_000)}` }); res.end(); return; }
  if (path === "/credentials") { res.writeHead(302, { location: sourceOrigin.replace("//", "//watcher:hunter2@") + "/settled" }); res.end(); return; }
  // The bot wall, and the hang-up. buzer.de answered the first six times on
  // 2026-09-20 and read clean the next morning; the three `fetch failed` runs
  // of 09-21 and after were the second, with nothing in the log to say so.
  if (path === "/refused") { res.writeHead(403, { "content-type": "text/plain" }); res.end("no"); return; }
  if (path === "/busy") { res.writeHead(503, { "content-type": "text/plain" }); res.end("later"); return; }
  if (path === "/hangup") { req.socket.destroy(); return; }
  // EUR-Lex's own shape: a status that says yes and no page behind it.
  if (path === "/empty") { res.writeHead(202, { "content-type": "text/html" }); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<p>The authority's own words</p>");
});
await new Promise<void>((resolve) => { source.listen(0, "127.0.0.1", () => resolve()); });
const sourceOrigin = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;

afterAll(() => { elsewhere.close(); source.close(); });

const textOf = (body: Uint8Array) => new TextDecoder().decode(body);

describe("s34 — a link is followed the way a person's browser follows it", () => {
  /**
   * The runner found this one, on 2026-09-24 (run 35934301563).
   *
   * `anabin.kmk.org` answers https with a 301 to plain http on the same host
   * — a real government source's TLS downgrade — and the origin guard written
   * for readings reported a live link as unreachable, every morning. The rule
   * was right and its scope was wrong: an entry that produces no reading has
   * no bytes anyone could have replaced, and what it watches is whether a
   * person who clicks arrives somewhere.
   */
  it("follows a downgrade to plain http on the same host", async () => {
    const answer = await fetchSource(`${sourceOrigin}/downgrade`, "anywhere");
    // Nothing is listening on the fixture's https address, so this ends as an
    // ordinary connection failure — which is the assertion: the guard did not
    // fire, the redirect was taken, and what is left is the network. (The
    // case below reads a different-origin redirect all the way through; this
    // one is here for the scheme change specifically.)
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the redirect was refused rather than followed").not.toMatch(/off the site/);
    expect(answer.error, "this did not get as far as the network").toMatch(/fetch failed|ECONN|socket/i);
  });

  it("follows a redirect to another site entirely", async () => {
    const answer = await fetchSource(`${sourceOrigin}/away`, "anywhere");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
    if (!answer.ok) return;
    expect(new TextDecoder().decode(answer.body)).toContain("Somewhere else entirely");
    // And it says where it ended up, which is the one thing worth knowing
    // about a link that has moved: a log line, not a flag and not a red day.
    expect(answer.from, "a link that landed elsewhere does not say where").toContain(elsewhereOrigin);
  });

  it("still refuses both for anything whose bytes become a reading", async () => {
    for (const path of ["/away", "/downgrade"]) {
      const answer = await fetchSource(`${sourceOrigin}${path}`, "same-origin");
      expect(answer.ok, `${path} was read as the authority's own bytes`).toBe(false);
      if (answer.ok) return;
      expect(answer.error).toMatch(/off the site/);
    }
  });

  it("caps the hops however far it is allowed to follow", async () => {
    const before = sourceAsked;
    const answer = await fetchSource(`${sourceOrigin}/loop`, "anywhere");
    expect(answer.ok).toBe(false);
    expect(sourceAsked - before, "a loop was followed further than the cap").toBeLessThanOrEqual(6);
  });
});

describe("s34 — there is a floor under following a link anywhere", () => {

  /**
   * "Anywhere a person's browser would" turned out to be wider than a
   * browser. Measured 2026-09-25: a `data:` target was followed and its
   * inline bytes came back as a reading, which a real browser refuses
   * outright; and `169.254.169.254` — where a cloud runner keeps its
   * credentials — was attempted, which on a hosted runner is a request that
   * reaches something. The policy allows a plaintext hop on purpose, so the
   * next `Location` is chosen by whoever is on the path and not only by the
   * source: the REQUEST is the harm, even where the bytes are never hashed.
   */
  for (const [what, path] of [
    ["a data: address", "/to-data"],
    ["a file: address", "/to-file"],
    ["the cloud metadata address", "/to-metadata"],
    ["a private network address", "/to-private"],
  ] as const) {
    it(`refuses ${what}, even for a link`, async () => {
      const answer = await fetchSource(`${sourceOrigin}${path}`, "anywhere");
      expect(answer.ok, `${what} was followed`).toBe(false);
      if (answer.ok) return;
      expect(answer.status, "the source's own answer is not reported").toBe(302);
    });
  }

  /**
   * The same places, spelled the other way, asked as a PUBLIC source asks.
   *
   * `[::ffff:7f00:1]` IS 127.0.0.1 and `[::ffff:a9fe:a9fe]` IS
   * 169.254.169.254 — an address has many spellings and one meaning, and the
   * floor was matching spellings (Security review, 2026-09-25).
   *
   * Asked of `refusedTarget` rather than through the fixtures, because the
   * fixtures live on loopback and the rule is relative: a loopback entry may
   * move within loopback, so a loopback fixture cannot pose the question a
   * public source poses. The end-to-end half is the case below, which proves
   * a refusal reaches the fetcher and costs the refused address nothing.
   */
  for (const [what, address, kind] of [
    ["an IPv4-mapped loopback address", "http://[::ffff:7f00:1]/admin", "loopback"],
    ["an IPv4-mapped metadata address", "http://[::ffff:a9fe:a9fe]/latest/", "link-local"],
    ["the unspecified address", "http://[::]/admin", "loopback"],
    ["loopback written out in full", "http://[0:0:0:0:0:0:0:1]/admin", "loopback"],
    ["IPv6 link-local", "http://[fe80::1]/admin", "link-local"],
    ["IPv6 private", "http://[fd00::1]/admin", "private"],
    ["plain 127.0.0.1", "http://127.0.0.1/admin", "loopback"],
    ["plain 169.254.169.254", "http://169.254.169.254/latest/", "link-local"],
    ["plain 10.0.0.1", "http://10.0.0.1/admin", "private"],
  ] as const) {
    it(`refuses ${what} when the source is on the open web`, () => {
      const target = new URL(address);
      // The classifier is the decision; the refusal has to name what IT says
      // this address is, not a word this test chose.
      expect(addressKind(target.hostname), `${what} is not classed as ${kind}`).toBe(kind);
      const why = refusedTarget(target, "rules.example.org");
      expect(why, `${what} was allowed`).not.toBeNull();
      expect(why, "the refusal does not say what kind of address it is")
        .toContain(addressKind(target.hostname));
    });
  }

  it("bounds an address before it is written down, however long a page makes it", () => {
    // The one bound, used by both readers and by every printer. Where the
    // browser's `anywhere` branch applies it is pinned in
    // `tests/s34-browser.test.ts`, at the call site.
    const long = `https://rules.example.org/${"a".repeat(9_000)}`;
    // The note's wording is asked of its owner, not retyped: a test that
    // spells a rule out passes while the rule is wrong (Standards review,
    // 2026-09-25).
    const suffix = noteOfLength([...long].length);
    // The bound is `MOST_OF_AN_ADDRESS` and the suffix that says what was cut
    // — asked of the constant, so moving it moves the test with it.
    expect(shortAddress(long)).toBe(long.slice(0, MOST_OF_AN_ADDRESS) + suffix);
    // And an ordinary one is left exactly as it is.
    const ordinary = "https://anabin.kmk.org/anabin.html";
    expect(ordinary.length).toBeLessThanOrEqual(MOST_OF_AN_ADDRESS);
    expect(shortAddress(ordinary)).toBe(ordinary);
  });

  it("still lets an ordinary public address through", () => {
    expect(refusedTarget(new URL("https://anabin.kmk.org/cms/public/startseite"), "rules.example.org")).toBeNull();
    // And the downgrade the whole rule exists for: same host, plain http.
    expect(refusedTarget(new URL("http://anabin.kmk.org/anabin.html"), "anabin.kmk.org")).toBeNull();
  });

  it("asks the refused address for nothing at all", async () => {
    // The refusal is made from the `Location` header, before anything is
    // requested — which is the difference between a rule and a regret.
    const before = elsewhereAsked;
    await fetchSource(`${sourceOrigin}/to-metadata`, "anywhere");
    await fetchSource(`${sourceOrigin}/to-private`, "anywhere");
    expect(elsewhereAsked - before).toBe(0);
  });

  it("still lets a link move within the kind of address its entry is on", async () => {
    // The rule is relative: a source may not send the watch somewhere it
    // could not have gone itself. These fixtures live on loopback, so a
    // loopback hop between them is exactly the ordinary case and must work —
    // it is a public source redirecting INTO the private network that is
    // refused.
    const answer = await fetchSource(`${sourceOrigin}/away`, "anywhere");
    expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
  });

  it("says where the chain had got to when the cap stopped it", async () => {
    const answer = await fetchSource(`${sourceOrigin}/loop`, "anywhere");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the message does not say where it was").toContain("/loop");
  });

  it("refuses a malformed entry address without repeating it", async () => {
    const answer = await fetchSource("://watcher:hunter2@example.invalid/x", "same-origin");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the password was printed").not.toContain("hunter2");
    expect(answer.error, "the name was printed").not.toContain("watcher");
  });
});

describe("s34 — the fetcher will not be redirected off the site", () => {
  it("reads a source that redirects within its own host, and says where it read", async () => {
    const answer = await fetchSource(`${sourceOrigin}/around`, "same-origin");
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(textOf(answer.body)).toContain("The authority's own words");
    expect(answer.from, "the reading does not say it moved").toBe(`${sourceOrigin}/settled`);
  });

  it("refuses a source that redirects to another host, and names where it went", async () => {
    const answer = await fetchSource(`${sourceOrigin}/away`, "same-origin");
    expect(answer.ok, "another site's bytes were accepted as the source's").toBe(false);
    if (answer.ok) return;
    // The decision is that it refused and said where — not the words it chose
    // to say it in.
    expect(answer.error, "the error does not name where it went").toContain(elsewhereOrigin);
  });

  it("never makes the off-site request at all, and reports the redirect's own status", async () => {
    // Following first and judging afterwards sent the watch's name and its
    // contact header to a third party, let a source point this reader at any
    // address it liked, and then reported the FAR server's status as the
    // source's — measured `status: 200`, from somebody else's page
    // (Security review, 2026-09-24).
    const before = elsewhereAsked;
    const answer = await fetchSource(`${sourceOrigin}/away`, "same-origin");
    expect(elsewhereAsked - before, "the other site was contacted").toBe(0);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.status, "the far server's status was reported as the source's").toBe(302);
  });

  it("stops rather than circles when a source redirects to itself for ever", async () => {
    // Countable, so the decision is the count and not the wording: a loop is
    // asked for at most one more time than the hops allowed.
    const before = sourceAsked;
    const answer = await fetchSource(`${sourceOrigin}/loop`, "same-origin");
    expect(answer.ok).toBe(false);
    expect(sourceAsked - before, "a loop was followed further than the cap").toBeLessThanOrEqual(6);
  });

  it("bounds an address a source chooses, however long it makes it", async () => {
    // A `location` of 9,000 characters made a 9,111-character error, which
    // went on into a flag and an issue (Security review, 2026-09-24).
    const refused = await fetchSource(`${sourceOrigin}/long`, "same-origin");
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.length, "the refusal quotes the whole of a page's address").toBeLessThan(400);
    expect(refused.error).toContain(elsewhereOrigin);

    // And the same bound on where it says it read.
    const read = await fetchSource(`${sourceOrigin}/longway`, "same-origin");
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.from!.length, "read_at carries the whole of a page's address").toBeLessThan(400);
  });

  it("refuses an address carrying a name and password, and never prints them", async () => {
    // `user:pass@host` keeps the origin, so the origin check passes it;
    // undici then refuses it at request time and the thrown string — with the
    // credentials in it — became the error, with no status to say what the
    // source had answered.
    const answer = await fetchSource(`${sourceOrigin}/credentials`, "same-origin");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the password was printed").not.toContain("hunter2");
    expect(answer.error, "the name was printed").not.toContain("watcher");
    expect(answer.status, "the source's own answer is not reported").toBe(302);
  });

  it("refuses an entry address carrying a name and password, and never prints them", async () => {
    // The redirect path was guarded in round 5 and this one was not: undici
    // refuses `user:pass@host` at request time and `String(e)` put the
    // credentials into the error (Security review, 2026-09-24).
    const answer = await fetchSource(`${sourceOrigin.replace("//", "//watcher:hunter2@")}/`, "same-origin");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the password was printed").not.toContain("hunter2");
    expect(answer.error, "the name was printed").not.toContain("watcher");
  });

  it("reports a malformed entry url as unreachable instead of taking the pass down", async () => {
    // It used to throw past `runWatch`, which took the reports, the state and
    // the flags for the other forty-four sources with it (Standards review,
    // 2026-09-24).
    const answer = await fetchSource("not-an-address", "same-origin");
    expect(answer.ok, "a malformed url was treated as a reading").toBe(false);
  });

  it("says nothing about where it read when it read where it was asked", async () => {
    const answer = await fetchSource(`${sourceOrigin}/`, "same-origin");
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.from, "an unmoved read claims to have moved").toBeUndefined();
  });
});

describe("s35 — the fetcher says what kind of failure it met", () => {
  /**
   * The three runs the slice was written for said `TypeError: fetch failed`
   * and nothing else — the same five words for a reset connection, a name
   * that does not resolve and a connect timeout, which is why the queue line
   * called them timeouts without knowing. The CODE is what tells them apart,
   * and it is the only part of the cause that may be printed: undici writes
   * the address into the message, and an error travels into a log line, a
   * flag file and the issue that flag becomes.
   */
  it("calls a source that hangs up transient, and carries the cause code in the text", async () => {
    const answer = await fetchSource(`${sourceOrigin}/hangup`, "same-origin");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("transient");
    // Not the wording of the failure — the code Node put underneath it, which
    // is what the log did not have.
    expect(answer.error, "the cause code is not in the text").toMatch(/\((ECONNRESET|UND_ERR_SOCKET|ECONNABORTED|EPIPE)\)/);
    // And never the cause's own message, which is where undici writes the
    // address. The decision is that the address does not reach a log line, a
    // flag file or the issue that flag becomes — not that the sentence came
    // out short, which a short undici message satisfies by accident
    // (Standards review, 2026-09-24).
    expect(answer.error, "the cause's message was printed too").not.toContain(sourceOrigin);
    expect(answer.error, "the address reached the text without its scheme")
      .not.toContain(new URL(sourceOrigin).host);
  });

  it("calls a bot wall the source's own refusal, and a busy source transient", async () => {
    const walled = await fetchSource(`${sourceOrigin}/refused`, "same-origin");
    expect(walled.ok).toBe(false);
    if (walled.ok) return;
    // A 403 answers the same in three minutes: no second try, and one day of
    // grace before the run goes red.
    expect(walled.failure).toBe("refused-by-source");
    expect(walled.status).toBe(403);

    const busy = await fetchSource(`${sourceOrigin}/busy`, "same-origin");
    expect(busy.ok).toBe(false);
    if (busy.ok) return;
    // The source calling it its own fault is worth asking again.
    expect(busy.failure).toBe("transient");
  });

  it("calls everything the floor declines our own refusal", async () => {
    // None of these is the source having a bad minute: the request was never
    // made, and would not be made three minutes later either. Each is red the
    // same day.
    const offsite = await fetchSource(`${sourceOrigin}/away`, "same-origin");
    expect(offsite.ok).toBe(false);
    if (!offsite.ok) expect(offsite.failure).toBe("refused-by-us");

    const metadata = await fetchSource(`${sourceOrigin}/to-metadata`, "anywhere");
    expect(metadata.ok).toBe(false);
    if (!metadata.ok) expect(metadata.failure).toBe("refused-by-us");

    const looping = await fetchSource(`${sourceOrigin}/loop`, "same-origin");
    expect(looping.ok).toBe(false);
    if (!looping.ok) expect(looping.failure).toBe("refused-by-us");

    const credentialled = await fetchSource(`${sourceOrigin.replace("//", "//watcher:hunter2@")}/`, "same-origin");
    expect(credentialled.ok).toBe(false);
    if (!credentialled.ok) expect(credentialled.failure).toBe("refused-by-us");
  });

  it("calls the budget running out transient, without holding this file open for 30 s", () => {
    // The budget is 30 s per source and is not injectable — it is one number
    // both readers borrow (s34, DECISIONS 2026-09-24), and making it a
    // parameter to make this case fast would be changing the code to suit the
    // test. So the question is put to the error path instead: this is exactly
    // what `AbortSignal.timeout` rejects a `fetch` with, and the class it
    // gets is the decision.
    expect(classOfThrown(new DOMException("The operation was aborted due to timeout", "TimeoutError")))
      .toBe("transient");
  });

  it("calls an empty body transient, because the challenge behind it is over in a minute", async () => {
    // EUR-Lex answers this fetcher HTTP 202 with nothing at all, and the page
    // is there on the next read.
    const answer = await fetchSource(`${sourceOrigin}/empty`, "same-origin");
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.failure).toBe("transient");
  });
});
