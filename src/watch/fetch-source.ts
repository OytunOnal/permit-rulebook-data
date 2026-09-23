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

/**
 * How long one source gets, on either tier.
 *
 * The fetcher is where this number lives because the scenario put it there —
 * point 5 asks the browser for "a per-entry budget of 30 s, like the
 * fetcher's" — so the browser imports it rather than spelling it again. It
 * was spelled twice, each comment citing the other (Standards review,
 * 2026-09-24).
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

export const fetchSource: Fetcher = async (url) => {
  const asked = new URL(url).origin;
  let target = url;
  try {
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
        signal: AbortSignal.timeout(BUDGET_MS),
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location)
          return { ok: false, status: res.status, error: `HTTP ${res.status} with nowhere to go` };
        const next = new URL(location, target);
        // The status reported is the REDIRECT's own, because that is the
        // answer this source gave; the far server was never asked.
        if (next.origin !== asked)
          return {
            ok: false,
            status: res.status,
            error: `redirected off the site: asked ${asked}, sent to ${next.origin}${next.pathname} (HTTP ${res.status}, not followed)`,
          };
        if (hop >= MOST_HOPS)
          return { ok: false, status: res.status, error: `redirected more than ${MOST_HOPS} times within ${asked}` };
        target = next.href;
        continue;
      }

      if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` };
      const body = new Uint8Array(await res.arrayBuffer());
      // An empty body is not a page, whatever the status line says. EUR-Lex
      // answers this fetcher with `202 Accepted` and nothing at all — a bot
      // challenge — and `res.ok` is true for it, so the pass would have recorded
      // a blank snapshot as a successful read and reported "unchanged" ever
      // after (measured 2026-09-10, s8).
      if (body.byteLength === 0) return { ok: false, status: res.status, error: `HTTP ${res.status} with an empty body` };
      return { ok: true, body, ...(target !== url ? { from: target } : {}) };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};
