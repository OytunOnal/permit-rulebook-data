import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchSource } from "../src/watch/fetch-source.js";

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
  if (path === "/around") { res.writeHead(302, { location: "/settled" }); res.end(); return; }
  if (path === "/loop") { res.writeHead(302, { location: "/loop" }); res.end(); return; }
  if (path === "/long") {
    res.writeHead(302, { location: `${elsewhereOrigin}/${"a".repeat(9_000)}` });
    res.end();
    return;
  }
  if (path === "/longway") { res.writeHead(302, { location: `/settled?${"b".repeat(12_000)}` }); res.end(); return; }
  if (path === "/credentials") { res.writeHead(302, { location: sourceOrigin.replace("//", "//watcher:hunter2@") + "/settled" }); res.end(); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<p>The authority's own words</p>");
});
await new Promise<void>((resolve) => { source.listen(0, "127.0.0.1", () => resolve()); });
const sourceOrigin = `http://127.0.0.1:${(source.address() as AddressInfo).port}`;

afterAll(() => { elsewhere.close(); source.close(); });

const textOf = (body: Uint8Array) => new TextDecoder().decode(body);

describe("s34 — the fetcher will not be redirected off the site", () => {
  it("reads a source that redirects within its own host, and says where it read", async () => {
    const answer = await fetchSource(`${sourceOrigin}/around`);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(textOf(answer.body)).toContain("The authority's own words");
    expect(answer.from, "the reading does not say it moved").toBe(`${sourceOrigin}/settled`);
  });

  it("refuses a source that redirects to another host, and names where it went", async () => {
    const answer = await fetchSource(`${sourceOrigin}/away`);
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
    const answer = await fetchSource(`${sourceOrigin}/away`);
    expect(elsewhereAsked - before, "the other site was contacted").toBe(0);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.status, "the far server's status was reported as the source's").toBe(302);
  });

  it("stops rather than circles when a source redirects to itself for ever", async () => {
    // Countable, so the decision is the count and not the wording: a loop is
    // asked for at most one more time than the hops allowed.
    const before = sourceAsked;
    const answer = await fetchSource(`${sourceOrigin}/loop`);
    expect(answer.ok).toBe(false);
    expect(sourceAsked - before, "a loop was followed further than the cap").toBeLessThanOrEqual(6);
  });

  it("bounds an address a source chooses, however long it makes it", async () => {
    // A `location` of 9,000 characters made a 9,111-character error, which
    // went on into a flag and an issue (Security review, 2026-09-24).
    const refused = await fetchSource(`${sourceOrigin}/long`);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.length, "the refusal quotes the whole of a page's address").toBeLessThan(400);
    expect(refused.error).toContain(elsewhereOrigin);

    // And the same bound on where it says it read.
    const read = await fetchSource(`${sourceOrigin}/longway`);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.from!.length, "read_at carries the whole of a page's address").toBeLessThan(400);
  });

  it("refuses an address carrying a name and password, and never prints them", async () => {
    // `user:pass@host` keeps the origin, so the origin check passes it;
    // undici then refuses it at request time and the thrown string — with the
    // credentials in it — became the error, with no status to say what the
    // source had answered.
    const answer = await fetchSource(`${sourceOrigin}/credentials`);
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
    const answer = await fetchSource(`${sourceOrigin.replace("//", "//watcher:hunter2@")}/`);
    expect(answer.ok).toBe(false);
    if (answer.ok) return;
    expect(answer.error, "the password was printed").not.toContain("hunter2");
    expect(answer.error, "the name was printed").not.toContain("watcher");
  });

  it("reports a malformed entry url as unreachable instead of taking the pass down", async () => {
    // It used to throw past `runWatch`, which took the reports, the state and
    // the flags for the other forty-four sources with it (Standards review,
    // 2026-09-24).
    const answer = await fetchSource("not-an-address");
    expect(answer.ok, "a malformed url was treated as a reading").toBe(false);
  });

  it("says nothing about where it read when it read where it was asked", async () => {
    const answer = await fetchSource(`${sourceOrigin}/`);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.from, "an unmoved read claims to have moved").toBeUndefined();
  });
});
