import { chromePath, launch } from "./chrome.js";
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

/** A per-entry budget, the fetcher's own. */
const BUDGET_MS = 30_000;

export interface BrowserReaderOptions {
  /** Where Chrome is. Injected so a test can ask what a run with no browser
   * does without uninstalling one. */
  chromeAt?: () => string;
  /** Per-entry budget in milliseconds. */
  budgetMs?: number;
}

export interface BrowserReaderHandle {
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

  const read: BrowserReader = async (entry) => {
    if (launchFailure) return { ok: false, error: launchFailure };
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
        return { ok: false, error: launchFailure };
      }
    }
    try {
      const html = await withDeadline(session.render(entry, budgetMs), budgetMs,
        `the browser did not finish this page within ${Math.round(budgetMs / 1000)}s`);
      return { ok: true, body: new TextEncoder().encode(html) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  return {
    read,
    async close() {
      const open = session;
      session = undefined;
      open?.close();
    },
  };
}

/** A promise with a bound on it, so one page cannot hold the whole run. */
async function withDeadline<T>(work: Promise<T>, ms: number, timedOut: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(timedOut)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
