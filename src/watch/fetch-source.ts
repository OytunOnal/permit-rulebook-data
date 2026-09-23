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

/** The same budget the browser reader gets. */
const BUDGET_MS = 30_000;

export const fetchSource: Fetcher = async (url) => {
  try {
    const res = await fetch(url, {
      redirect: "follow",
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
      signal: AbortSignal.timeout(BUDGET_MS),
    });
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };

    /**
     * Redirects are followed, but not off the site.
     *
     * `redirect: "follow"` is right for the journey a source makes within its
     * own host — a trailing slash, a cookie check, a language prefix — and
     * wrong the moment it leaves: a source that 302s to somebody else is then
     * read there, and a third party's bytes are hashed as the authority's,
     * checked against the quotes, and filed in an issue under the authority's
     * name. The browser reader was closed against exactly this on 2026-09-24
     * and this is the same harm one tier over.
     *
     * Only the origin is judged. Where a source moves within its own site the
     * reading stands and says where it came from.
     */
    const asked = new URL(url).origin;
    const answered = new URL(res.url).origin;
    if (answered !== asked)
      return { ok: false, status: res.status, error: `redirected off the site: asked ${asked}, answered by ${res.url}` };

    const body = new Uint8Array(await res.arrayBuffer());
    // An empty body is not a page, whatever the status line says. EUR-Lex
    // answers this fetcher with `202 Accepted` and nothing at all — a bot
    // challenge — and `res.ok` is true for it, so the pass would have recorded
    // a blank snapshot as a successful read and reported "unchanged" ever
    // after (measured 2026-09-10, s8).
    if (body.byteLength === 0) return { ok: false, status: res.status, error: `HTTP ${res.status} with an empty body` };
    return { ok: true, body, ...(res.url !== url ? { from: res.url } : {}) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};
