import { chromePath, launch } from "./chrome.js";
import { BUDGET_MS, refusedAddress } from "./fetch-source.js";
import { classOfThrown, ReadFailure } from "./failure.js";
import type { Session } from "./cdp.js";
import type { BrowserReader, FetchResult, WatchEntry } from "./core.js";

/**
 * The watch's second reader: a real browser, spoken to over its own protocol.
 *
 * Seven of this project's sources never put their operative text in front of a
 * `fetch`. Five IND route pages render their requirements from a script behind
 * a form; the Opportunity Card's notice is served only after a cookie
 * round-trip; EUR-Lex answers this fetcher HTTP 202 with an empty body. A
 * browser does all three without being asked, because it is the client those
 * walls were built for.
 *
 * No npm dependency, for the same reason the site's own harness has none: a
 * browser driver is a large, fast-moving package to take on for one file's
 * worth of CDP, and this package ships to a browser itself — its dependency
 * list is read by anyone who installs it. Chrome exposes a WebSocket and a
 * dozen methods; those are what this speaks. The site's `scripts/browser.mjs`
 * and `scripts/chrome.mjs` are where the launch, the endpoint handshake and
 * the profile handling were learned, and this is a port of them: the data
 * package cannot import the site.
 *
 * **Where things are.** This was one file until 2026-09-24, by then five jobs
 * deep, so it is four — split along what each part answers to:
 *
 * - `chrome.ts`  where the browser is, the profile it runs in, starting and
 *                killing it.
 * - `cdp.ts`     the protocol: attaching, sending, what the page asked the
 *                network for, when the page has stopped moving, and the
 *                render of one entry.
 * - `steps.ts`   the vocabulary — select, answer, press, expand — how a field
 *                is driven however the page built it, and the diagnosis a
 *                failure carries.
 * - `browser.ts` this file: one browser per run, the per-entry budget, and
 *                the reader `runWatch` is handed.
 *
 * Nothing in any of them is reachable from `src/index.ts` — the package a
 * browser imports must reach no Node built-in, and these are nothing but Node.
 */

export { chromePath } from "./chrome.js";
export type { WatchStep } from "./core.js";


export interface BrowserReaderOptions {
  /** Where Chrome is. Injected so a test can ask what a run with no browser
   * does without uninstalling one. */
  chromeAt?: () => string;
  /** Per-entry budget in milliseconds. */
  budgetMs?: number;
}

export interface BrowserReaderHandle {
  /** What the interception cost the page just read. */
  lastCost(): { paused: number; pausedMs: number };
  /** The reader `runWatch` is handed. Launches Chrome on the first entry that
   * needs it, and keeps it for the rest of the run. */
  read: BrowserReader;
  /** Closes the browser, if one was ever opened. Safe to call twice. */
  close(): Promise<void>;
}

/**
 * One browser for the whole run, opened when the first browser entry asks for
 * it and not before.
 *
 * Lazily, because a run whose `--only` filter names an html entry should not
 * pay for a browser, and eagerly-launching would make every run depend on a
 * Chrome most of them do not use. Once, because seven launches cost seven
 * cold starts for nothing.
 *
 * A launch that fails is remembered rather than retried: the second entry's
 * Chrome is not going to be found where the first one's was not, and a
 * runner without a browser would otherwise spend seven timeouts proving it.
 */
export function openBrowserReader(options: BrowserReaderOptions = {}): BrowserReaderHandle {
  const budgetMs = options.budgetMs ?? BUDGET_MS;
  const findChrome = options.chromeAt ?? chromePath;
  let session: Session | undefined;
  let launchFailure: string | undefined;
  /** What the interception cost the last page read — for the run's own log. */
  let lastCost: { paused: number; pausedMs: number } = { paused: 0, pausedMs: 0 };

  const read: BrowserReader = async (entry, redirects) => {
    // This page's counts, and only this page's. A refused or failed read used
    // to leave the previous page's numbers standing, so the
    // `watch:browser-read` line reported one entry's cost against another's
    // name (Standards review, 2026-09-25).
    lastCost = { paused: 0, pausedMs: 0 };
    // Before anything is opened. A browser sends credentials the moment it
    // navigates and keeps sending them: measured 2026-09-24, a credentialled
    // entry read `ok: true` and the host saw `Authorization: Basic …` on the
    // page AND on the favicon, with the page behind the password hashed and
    // ready to commit. The rule — credentials, a malformed address, a scheme
    // this watch does not read — is the fetcher's, asked here rather than
    // spelled again.
    const refused = refusedAddress(entry.url);
    // Both are ours and neither is a minute: an address this watch will not
    // open stays one, and a machine with no Chrome will not grow one during
    // the pass.
    if (refused) return { ok: false, error: refused, failure: "refused-by-us" };
    if (launchFailure) return { ok: false, error: launchFailure, failure: "refused-by-us" };
    if (!session) {
      try {
        // Under the same budget as a page. A Chrome that starts and never
        // reports its endpoint, or a socket that neither opens nor errors,
        // would otherwise hold the whole run until GitHub's job ceiling —
        // the one wait in this file that `withDeadline` did not cover.
        session = await withDeadline(launch(findChrome(), budgetMs), budgetMs,
          `Chrome did not become usable within ${Math.round(budgetMs / 1000)}s`);
      } catch (e) {
        launchFailure = `no browser: ${e instanceof Error ? e.message : String(e)}`;
        return { ok: false, error: launchFailure, failure: "refused-by-us" };
      }
    }
    try {
      const read = await withDeadline(session.render(entry, budgetMs, redirects), budgetMs,
        `the browser did not finish this page within ${Math.round(budgetMs / 1000)}s`);
      lastCost = read.cost;
      return { ok: true, body: new TextEncoder().encode(read.html), from: read.from };
    } catch (e) {
      // Whatever failed named its own class on the way up — a step that found
      // no field, a navigation off the origin, a status the page was served.
      // Anything that did not is something that merely did not happen, and is
      // worth the one more read the pass will give it.
      return { ok: false, error: e instanceof Error ? e.message : String(e), failure: classOfThrown(e) };
    }
  };

  return {
    read,
    lastCost: () => lastCost,
    async close() {
      const open = session;
      session = undefined;
      open?.close();
    },
  };
}

/**
 * A promise with a bound on it, so one page cannot hold the whole run.
 *
 * The budget running out is transient on either tier: the page did not
 * settle in thirty seconds, which says nothing about whether it will settle
 * in the next thirty.
 */
async function withDeadline<T>(work: Promise<T>, ms: number, timedOut: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadFailure(timedOut, "transient")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
