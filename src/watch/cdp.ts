import type { RedirectPolicy, WatchEntry, WatchStep } from "./core.js";
import { PERFORM_STEP, selectInto } from "./steps.js";
import { shortAddress } from "./fetch-source.js";
import { failureOfStatus, ReadFailure, shortFailure } from "./failure.js";

/**
 * The DevTools client: attaching to a tab, asking Chrome things, keeping the
 * books on what the page asked the network for, deciding when a page has
 * stopped moving, and rendering one entry from navigation to HTML. See
 * `browser.ts` for the map.
 */

/**
 * Who is asking, in the string the page sees.
 *
 * The fetcher's own name, carried into Chrome's User-Agent beside Chrome's:
 * a host that blocks this watch must be able to block it by name, and a host
 * that let the browser through on 2026-09-15 saw a string shaped like this
 * one. The browser half stays because a page that renders from a script
 * frequently decides what to render by it.
 */
export const WATCH_NAME = "permit-rulebook-watch/0.1";

/** Where to find whoever sent it, beside the name — the fetcher's own header. */
export const WATCH_CONTACT = "https://github.com/OytunOnal/permit-rulebook-data";

/**
 * How long the page must go without touching its own DOM, or the network, to
 * count as finished.
 *
 * 2.5 s, and the number is the whole of the risk this reader carries. Measured
 * on ind.nl, 2026-09-23: the shell a `fetch` receives carries the page's lede
 * AND its footer — both of a route entry's slice markers — and the requirement
 * list arrives afterwards. A window of 600 ms read that shell and sliced 663
 * characters out of a 14,600-character page: not a slow read, a wrong one, and
 * one that would have hashed as a change and put every quote on the page into
 * `missing`. Too long only costs seconds; too short reports the authority as
 * having rewritten a page it never touched.
 */
const QUIET_MS = 2_500;

/** The floor under the wait: a page that renders nothing has still been given
 * its turn, and one that never stops mutating is read at the budget. */
const MIN_SETTLE_MS = 1_000;

/**
 * The same wait, between one step and the next, where it can be much shorter.
 *
 * The long window exists to protect the READING — the snapshot a quote is
 * checked against, which must be of a finished page. Between steps there is a
 * better guarantee available than any amount of waiting: the next step looks
 * for its own label, and says so when it is not there. So the wait between
 * steps is short and a step that cannot find its target is given one more
 * chance after a full settle, which turns "the page had not caught up" from a
 * red day into a second attempt.
 *
 * Measured on a fixture that mirrors the IND's form and blocks its main thread
 * after every click (2026-09-23): the five-step recipe cost 16.7 s with a full
 * window between every step and 10.1 s with this one, and the entry's 30 s
 * budget went from surviving 2 s of freeze per click to surviving 4 s (29.6 s
 * at four, over at five). The reading itself is unchanged — the settle before
 * the HTML is read is still the long one.
 *
 * What this does NOT buy is patience with a page that freezes for the 30-50 s
 * a real browser showed on 2026-09-23: five clicks of that is three minutes,
 * and no wait-shortening reaches it. If the runner sees that too, the answer
 * is a bigger budget for browser entries and a slower job, which is a decision
 * with a cost and belongs to whoever is holding the five-minute line — not to
 * this constant.
 */
const STEP_QUIET_MS = 800;

export interface Session {
  /** The page's HTML, and the address it was actually read at. */
  render(entry: WatchEntry, budgetMs: number, redirects: RedirectPolicy): Promise<{
    html: string;
    from: string;
    /** What the interception cost this read — paused requests and their total wait. */
    cost: { paused: number; pausedMs: number };
  }>;
  close(): void;
}

/** The session over an open DevTools socket — the protocol half of `launch`. */
export function attach(socket: WebSocket, close: () => void): Session {

  let nextId = 0;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  /**
   * The status line of the document each tab was actually served.
   *
   * A browser renders an error page as willingly as a good one, and its words
   * are words: Chromium's own ERR_NETWORK_CHANGED interstitial arrived mid-run
   * on 2026-09-23 as 185 kB of markup and 127 characters of text, and nothing
   * in a read of the DOM could tell it from the page. The fetcher refuses a
   * status that is not ok and refuses an empty body; this listens for the same
   * fact, which only the protocol can tell it.
   */
  const documentStatus = new Map<string, { status: number; url: string }>();
  /** Which frame IS the page, per tab — everything else in it is furniture. */
  const mainFrame = new Map<string, string>();
  /**
   * The one origin this tab may be told who is asking, per tab.
   *
   * `setUserAgentOverride` is per-SESSION, so the watch's name in the
   * User-Agent reaches every host a page embeds — measured 2026-09-24, a
   * cross-origin iframe was handed it, along with the contact header the
   * session used to carry as well. The fetcher only ever names itself to the
   * source it was pointed at; this is what makes the browser tier keep the
   * same promise, by putting the name back to plain Chrome on the way out to
   * anybody else and adding the contact header only on the way to the source.
   */
  const identifyTo = new Map<string, string>();
  /**
   * What the interception cost this tab: how many requests it paused, and how
   * long they spent paused in total.
   *
   * Measured rather than assumed, because the reading of a page is now on the
   * far side of a round-trip per request and the entry's budget is 30 s — and
   * two entries have already moved close enough to it to be worth watching
   * (s34, 2026-09-25).
   *
   * `paused` counts every request this driver was handed to decide about,
   * including one that turned out to be gone by the time it was let go.
   * `pausedMs` counts only the ones that were let go successfully, since a
   * request nobody received spent no time waiting on us.
   */
  const interceptions = new Map<string, { paused: number; pausedMs: number }>();
  const costOf = (sessionId: string) => {
    const cost = interceptions.get(sessionId) ?? { paused: 0, pausedMs: 0 };
    interceptions.set(sessionId, cost);
    return cost;
  };
  /** Requests each tab has started and not yet finished — one half of what
   * "the page has stopped" means. */
  const inFlight = new Map<string, Set<string>>();
  const requestsOf = (sessionId: string) => {
    const open = inFlight.get(sessionId) ?? new Set<string>();
    inFlight.set(sessionId, open);
    return open;
  };
  /**
   * What each tab asked the network for, and what it got back.
   *
   * A widget that renders nothing has either not asked or been refused, and a
   * step that reports only "offered nothing" cannot tell those apart — which
   * on 2026-09-23 was the whole of what five runs and a fifth render had
   * established. The request line is the missing half: a suggestion endpoint
   * answering 403 to this client says the wall is the client, and no request
   * at all says the widget never ran.
   */
  interface Asked { url: string; type: string; at: number; status?: number; bytes?: number; error?: string }
  const traffic = new Map<string, Map<string, Asked>>();
  const trafficOf = (sessionId: string) => {
    const seen = traffic.get(sessionId) ?? new Map<string, Asked>();
    traffic.set(sessionId, seen);
    return seen;
  };
  /** Host and path only — never a query, which is where a page puts what was typed. */
  const withoutQuery = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "data:" ? "data:..." : `${parsed.host}${parsed.pathname}`;
    } catch { return url.slice(0, 60); }
  };
  const askedSince = (sessionId: string, since: number): string[] =>
    [...trafficOf(sessionId).values()]
      .filter((a) => a.at >= since && a.type !== "Document" && a.type !== "Image" && a.type !== "Font")
      .sort((a, b) => a.at - b.at)
      .slice(0, 8)
      .map((a) => `${a.type || "?"} ${withoutQuery(a.url)} -> `
        + (a.error ? `failed (${a.error})` : a.status === undefined ? "no answer yet" : `${a.status}, ${a.bytes ?? 0} bytes`));
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number; method?: string; sessionId?: string;
      params?: {
        type?: string; requestId?: string; errorText?: string; encodedDataLength?: number; frameId?: string;
        request?: { url?: string; headers?: Record<string, string> };
        response?: { status?: number; url?: string };
      };
      error?: { message: string }; result?: Record<string, unknown>;
    };
    if (message.sessionId && message.params?.requestId) {
      const id = message.params.requestId;
      const seen = trafficOf(message.sessionId);
      if (message.method === "Network.requestWillBeSent") {
        /**
         * Only the main frame's requests count as the page still loading.
         *
         * A genuinely cross-site iframe runs in a process of its own, and its
         * document request is STARTED in this session and finished in the
         * iframe's own target — so the count never came back to zero and the
         * page was never finished: measured 2026-09-24, `did not finish this
         * page within 45s` on a page whose only sin was embedding somebody.
         * The Document handling was scoped to the main frame in round 4; the
         * wait is the other half of the same rule.
         */
        if (message.params.frameId === mainFrame.get(message.sessionId))
          requestsOf(message.sessionId).add(id);
        seen.set(id, {
          url: message.params.request?.url ?? "",
          type: message.params.type ?? "",
          at: Date.now(),
        });
      } else if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed") {
        requestsOf(message.sessionId).delete(id);
        const asked = seen.get(id);
        if (asked) {
          if (message.method === "Network.loadingFailed") asked.error = message.params.errorText ?? "blocked";
          else asked.bytes = message.params.encodedDataLength ?? 0;
        }
      } else if (message.method === "Network.responseReceived") {
        const asked = seen.get(id);
        if (asked) {
          asked.status = message.params.response?.status;
          if (message.params.type) asked.type = message.params.type;
        }
      }
    }
    if (message.method === "Network.responseReceived" && message.params?.type === "Document" && message.sessionId) {
      /**
       * The MAIN frame's document, and nothing else.
       *
       * Subframes share this flat session and their documents arrive on it
       * looking exactly like the page's. Until this was scoped, on
       * 2026-09-24, any iframe in a source page did two things: it set the
       * status the page would be judged by, and it cleared the in-flight
       * count — which is the wait. Measured, two pages identical but for one
       * same-origin 1×1 iframe, the content arriving on a 6 s request: without
       * the iframe, read in 10.3 s with the content in it; with the iframe,
       * 3.7 s and the SHELL, `ok: true`, hashed as the authority's reading
       * and `unchanged` every morning after. A consent widget or an embed is
       * enough to do that, and neither is the authority.
       */
      if (message.params.frameId !== mainFrame.get(message.sessionId)) return;
      const response = message.params.response;
      documentStatus.set(message.sessionId, { status: response?.status ?? 0, url: response?.url ?? "" });
      // A new document means the old one's unfinished requests belong to a
      // page that no longer exists. Chrome does not always close their books
      // when a navigation cancels them, and a request counted as in flight
      // for ever keeps the settle rule waiting for ever — which turned a page
      // that meta-refreshed to another site from "refused, and here is where
      // it went" into "the browser did not finish this page within 30s"
      // (measured 2026-09-24).
      requestsOf(message.sessionId).clear();
      return;
    }
    /**
     * Every request the tab makes, paused just long enough to decide whether
     * this host is the one we are talking to.
     *
     * The source's own requests are continued with the watch's name already
     * in the User-Agent and the contact header added here. Everything else —
     * an embed, a consent widget, a font — is continued with the name taken
     * back out and no contact header ever added: those two say WHO is reading
     * and WHY, and a third party the source happens to embed is owed neither.
     * Nothing is dropped off-origin, because nothing is put there.
     *
     * Every paused request is continued, including on the failure path: a
     * request left paused stops the page, and while the read's own deadline
     * bounds that to one entry rather than the run, a bound is not a reason
     * to leave one hanging.
     */
    if (message.method === "Fetch.requestPaused" && message.sessionId && message.params?.requestId) {
      const sessionId = message.sessionId;
      const requestId = message.params.requestId;
      const mine = identifyTo.get(sessionId);
      const url = message.params.request?.url ?? "";
      let sameOrigin = false;
      try { sameOrigin = Boolean(mine) && new URL(url).origin === mine; } catch { sameOrigin = false; }
      const headers = Object.entries(message.params.request?.headers ?? {})
        .map(([name, value]) => ({ name, value: String(value) }));
      const resume = sameOrigin
        // The source is told where to find the operator, here rather than on
        // the session, so the header exists on its requests and on nothing
        // else's.
        ? { requestId, headers: [...headers, { name: "x-source-contact", value: WATCH_CONTACT }] }
        // Everybody else gets what a visitor's browser would send: the watch's
        // name comes out of the User-Agent, and no header is added that was
        // not going to be there.
        : {
          requestId,
          headers: headers.map(({ name, value }) => ({
            name,
            value: name.toLowerCase() === "user-agent" ? value.replace(` ${WATCH_NAME}`, "") : value,
          })),
        };
      const cost = costOf(sessionId);
      cost.paused += 1;
      const pausedAt = Date.now();
      send("Fetch.continueRequest", resume, sessionId).then(() => {
        cost.pausedMs += Date.now() - pausedAt;
      }).catch(() => {
        // The request is already gone — a navigation cancelled it, or the tab
        // closed under it. Nothing is waiting on it either way.
      });
      return;
    }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    for (const [id, waiter] of pending) { pending.delete(id); waiter.reject(new Error("Chrome closed the connection")); }
  });

  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  return {
    close,
    async render(entry, budgetMs, redirects) {
      // When this page's budget runs out, measured from the top of the read —
      // the same clock `withDeadline` is holding over this call. A step that
      // bounded its own work by a fresh 30 s would be cut off mid-diagnosis by
      // that outer timeout, which is the one way a diagnosis is worse than
      // useless: it costs the run and says nothing.
      const renderBy = Date.now() + budgetMs;
      // A tab per entry, closed after it. One tab reused across seven pages
      // carries the previous page's scroll, focus and any state a script left
      // on `window`; a fresh target is what "the page, opened" means.
      const { targetId } = await send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      const attached: string[] = [];
      try {
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
        attached.push(sessionId);
        await send("Page.enable", {}, sessionId);
        // Asked once, before anything navigates: the frame tree's root is the
        // page, and every Document event that is not its is a subframe's.
        const tree = await send("Page.getFrameTree", {}, sessionId) as { frameTree?: { frame?: { id?: string } } };
        const rootId = tree.frameTree?.frame?.id;
        // Nothing about the source refused anything: the browser did not
        // answer a question it always answers, and one more go costs a render.
        if (!rootId) throw new ReadFailure("the browser would not say which frame is the page", "transient");
        mainFrame.set(sessionId, rootId);
        await send("Runtime.enable", {}, sessionId);
        await send("Network.enable", {}, sessionId);
        const ua = await send("Browser.getVersion") as { userAgent?: string };
        /**
         * Who is asking, and where to find them — added to the source's own
         * requests as they go out, and never set on the tab.
         *
         * `Network.setExtraHTTPHeaders` was the obvious way and it was wrong
         * twice over. It puts the header on every request the page makes, so
         * a host the source merely embeds learned it; and — the part that
         * cost a reading rather than a secret — an extra header makes a
         * cross-origin request NON-SIMPLE, so Chrome sends an `OPTIONS`
         * preflight announcing `x-source-contact` by name before the request
         * the interception would have edited. Against an ordinary CORS
         * endpoint that allows the origin and nothing else, the preflight is
         * refused and the page's own call FAILS — where a visitor's browser
         * makes a simple GET and succeeds. A page whose content arrives that
         * way renders short for this watch and for nobody else, which is the
         * wrong-reading class of fault this slice exists to avoid
         * (Security review, 2026-09-24).
         *
         * So the header is added at continue time, to same-origin requests
         * only. What leaves this browser for anybody else is byte-for-byte
         * what a visitor's browser would send.
         */
        identifyTo.set(sessionId, new URL(entry.url).origin);
        await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
        await send("Network.setUserAgentOverride", {
          userAgent: `${(ua.userAgent ?? "Mozilla/5.0").replace("HeadlessChrome", "Chrome")} ${WATCH_NAME}`,
        }, sessionId);
        // Installed before the document's own scripts, so the first mutation
        // a framework makes is already being counted.
        await send("Page.addScriptToEvaluateOnNewDocument", { source: QUIET_WATCHER }, sessionId);

        const evaluate = async (expression: string): Promise<unknown> => {
          const answer = await send("Runtime.evaluate", {
            expression, returnByValue: true, awaitPromise: true,
          }, sessionId) as { result?: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
          if (answer.exceptionDetails)
            // The page's own script threw under us, which is the page having
            // changed and not a minute that will pass.
            //
            // The words are the PAGE's, stack and all, and the stack names
            // the page: bounded here, where they arrive, because everything
            // downstream of this throw treats them as a failure's text like
            // any other (Security review, 2026-09-24).
            throw new ReadFailure(
              shortFailure(
                answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? "the page threw",
              ),
              "refused-by-source");
          return answer.result?.value;
        };

        documentStatus.delete(sessionId);
        inFlight.delete(sessionId);
        const stillLoading = () => requestsOf(sessionId).size;
        const navigation = await send("Page.navigate", { url: entry.url }, sessionId) as { errorText?: string };
        // Chrome says here whether it got anywhere. Asking the DOM instead is
        // asking the error page whether it is the page.
        // The browser tier's own socket failure: nothing answered, which is
        // the same fact the fetcher calls `fetch failed`.
        if (navigation.errorText)
          throw new ReadFailure(`the browser could not reach the page: ${navigation.errorText}`, "transient");
        await settle(evaluate, stillLoading, renderBy);
        const servedOk = () => {
          const served = documentStatus.get(sessionId);
          if (!served)
            throw new ReadFailure("the browser received no document response for this page", "transient");
          if (served.status < 200 || served.status >= 300)
            throw new ReadFailure(
              `HTTP ${served.status} in the browser${served.url && served.url !== entry.url ? ` (after redirect to ${served.url})` : ""}`,
              // The same rule the fetcher reads a status by.
              failureOfStatus(served.status));
        };
        servedOk();

        /**
         * Where the tab is allowed to be: the origin the watchlist named, and
         * nothing else.
         *
         * The baseline is the ENTRY's origin, not wherever the navigation
         * happened to end. Reading it off the loaded page instead — which is
         * what this did until 2026-09-24 — hands the decision to whoever the
         * page redirects to: a source that 302s or meta-refreshes to a third
         * party on load is read there, the far 200 satisfies the status gate,
         * the far origin becomes the baseline, and the check after the steps
         * compares it with itself and passes. Measured in both shapes, both
         * `ok: true` with the other site's body as the reading.
         *
         * A redirect chain WITHIN the origin is fine and is not a special
         * case: the Opportunity Card's notice goes to a cookie check and back
         * to bmi.bund.de, and ends where it started, which is the whole of
         * what is asked.
         */
        const allowedOrigin = new URL(entry.url).origin;
        const whereAmI = async () => await evaluate("location.origin + String.fromCharCode(32) + location.href") as string;
        /**
         * The rule comes from the strategy table, like the fetcher's.
         *
         * Every browser entry is `same-origin` today and this changes nothing
         * — but the row said one thing and this file did another, so the row
         * was decoration: a change to it changed no behaviour. One owner for
         * both readers (Standards review, 2026-09-25).
         */
        const mustBeHome = async (when: string) => {
          if (redirects !== "same-origin") return shortAddress((await whereAmI()).split(" ")[1] as string);
          const [origin, href] = (await whereAmI()).split(" ") as [string, string];
          // The address is the page's to choose, and a page can make it as
          // long as it likes: one `history.pushState` produced 120,032
          // characters of it, which went into the error, the log line, and
          // from there a flag and an issue (Security review, 2026-09-24). The
          // bound is the fetcher's, because it met the same thing first.
          const short = shortAddress(href);
          if (origin !== allowedOrigin)
            // Ours: a third party's bytes must never be hashed as the
            // authority's, and that is a decision, not a bad minute.
            throw new ReadFailure(
              `${when}: the page was asked for at ${allowedOrigin} and the browser is at ${short}`, "refused-by-us");
          return short;
        };
        await mustBeHome("the page redirected to another site before it could be read");
        const inPage = (step: unknown, phase?: string) =>
          evaluate(`(${PERFORM_STEP})(${JSON.stringify(step)}${phase ? `, ${JSON.stringify(phase)}` : ""})`);
        /** A word, typed — one real key event per character, into whatever has focus. */
        const type = async (text: string) => {
          for (const character of [...text]) {
            await send("Input.dispatchKeyEvent", {
              type: "keyDown", text: character, unmodifiedText: character, key: character,
            }, sessionId);
            await send("Input.dispatchKeyEvent", { type: "keyUp", key: character }, sessionId);
          }
        };

        const perform = async (step: WatchStep) => step.step === "select"
          ? await selectInto(step, inPage, type, renderBy, (since) => askedSince(sessionId, since))
          : await inPage(step) as string | null;
        for (const step of entry.steps ?? []) {
          let failure = await perform(step);
          if (failure) {
            // A label that is not there yet reads exactly like a label that is
            // gone. The page gets the long settle and the step gets one more
            // go before the day is called red — and if it is genuinely gone,
            // the second failure carries the same diagnosis as the first.
            await settle(evaluate, stillLoading, renderBy);
            failure = await perform(step);
            // The page changed: a control the authority renamed, a question
            // that is no longer asked. The same page answers the same way in
            // three minutes, so this is the source's refusal and not a hiccup.
            if (failure) throw new ReadFailure(failure, "refused-by-source");
          }
          await settle(evaluate, stillLoading, renderBy, STEP_QUIET_MS);
        }
        // The reading is of a finished page, whatever the steps did: the last
        // wait before the HTML is taken is the long one.
        await settle(evaluate, stillLoading, renderBy);

        /**
         * Is the tab still on the page we came to read?
         *
         * A step presses things, and a thing that is pressed can navigate. The
         * status gate above fires once, before the steps, so until this check
         * existed a link or a handler that set `location` could move the tab
         * to another site and the reader would hand back whatever it landed
         * on — measured 2026-09-24: a page carrying a cross-origin link marked
         * as a disclosure returned `ok: true` with the OTHER origin's 404 body
         * as the reading. That is the worst failure this reader has: a third
         * party's bytes hashed as the authority's, checked against the quotes,
         * and written into a flag and an issue under the authority's name.
         *
         * Two questions, because one is not enough: the origin, because that
         * is the line between this source and somebody else's; and the status
         * again, because a navigation that happened after the steps has a
         * status of its own that nothing has looked at.
         */
        const finalHref = await mustBeHome("a step navigated the browser away from the site");
        servedOk();
        return {
          html: await evaluate("document.documentElement.outerHTML") as string,
          from: finalHref,
          cost: { ...costOf(sessionId) },
        };
      } finally {
        // The tab goes, and so does everything this run remembered about it:
        // a session id Chrome may reuse must not arrive carrying the previous
        // page's status line or its half-finished requests.
        for (const id of attached) {
          inFlight.delete(id); documentStatus.delete(id); traffic.delete(id);
          mainFrame.delete(id); identifyTo.delete(id); interceptions.delete(id);
        }
        await send("Target.closeTarget", { targetId }).catch(() => { /* the run is ending anyway */ });
      }
    },
  };
}

/**
 * Waits until the page has stopped changing itself.
 *
 * "Settled" is the hard question a browser read has and a fetch does not, and
 * the honest answers are all approximations. A fixed delay is either too short
 * for a slow render or a tax on every page; the load event fires before a
 * script-rendered requirement list exists at all; a network-idle rule waits on
 * analytics beacons that have nothing to do with the words.
 *
 * So three things are asked, and all three must hold at once: the document has
 * finished loading, nothing is in flight, and the DOM has been still for
 * `QUIET_MS`. A MutationObserver installed before the document's own scripts
 * answers the third; the protocol answers the second. Any one of them alone
 * passes on a page that is about to render its rules — `load` fires before a
 * script-rendered list exists, an idle network says nothing about a timer, and
 * a lull in the DOM is exactly what a page looks like just before it fills.
 *
 * It is handed the read's own deadline rather than starting a budget afresh,
 * so it cannot wait past the moment the read is already racing. It does not
 * report anything when it gets there: it returns, and whether the page is
 * then read or abandoned is decided above it — in practice by `withDeadline`,
 * whose timer is armed a moment AFTER `renderBy` is set and on the same
 * budget, so it fires a moment later — and it is what turns a page that never
 * stops moving into `unreachable`. Two timers, one budget; this one is the
 * inner and the quieter of them.
 */
async function settle(
  evaluate: (expression: string) => Promise<unknown>,
  inFlight: () => number,
  deadline: number,
  quietMs = QUIET_MS,
): Promise<void> {
  await new Promise((r) => setTimeout(r, MIN_SETTLE_MS));
  for (;;) {
    if (Date.now() >= deadline) return;
    const state = await evaluate(
      "JSON.stringify([document.readyState, Date.now() - (window.__watchLastMutation || 0)])",
    ) as string;
    const [readyState, quietFor] = JSON.parse(state) as [string, number];
    if (readyState === "complete" && inFlight() === 0 && quietFor >= quietMs) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Runs in the page, before its own scripts: when did the DOM last move? */
const QUIET_WATCHER = `
window.__watchLastMutation = Date.now();
new MutationObserver(function () { window.__watchLastMutation = Date.now(); })
  .observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
`;
