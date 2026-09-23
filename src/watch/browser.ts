import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserReader, FetchResult, WatchEntry, WatchStep } from "./core.js";

/**
 * The watch's second reader: a real browser, spoken to over its own protocol.
 *
 * Seven of this project's sources never put their operative text in front of a
 * `fetch`. Five IND route pages render their requirements from a script; the
 * Opportunity Card's notice is served only after a cookie round-trip; EUR-Lex
 * answers this fetcher HTTP 202 with an empty body. A browser does all three
 * without being asked, because it is the client those walls were built for.
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
 * Nothing here is reachable from `src/index.ts` — the package a browser
 * imports must reach no Node built-in, and this file is nothing but Node.
 */

/**
 * Where Chrome is, asked once — the site's `scripts/chrome.mjs`, ported.
 *
 * The runner's image has changed which of these names it installs more than
 * once, so all of them are asked for and PATH is asked last.
 */
const CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/opt/google/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/snap/bin/chromium",
];

/** The same names, resolved through PATH where the fixed locations miss. */
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium", "chrome"];

function fromPath(): string | undefined {
  if (process.platform === "win32") return undefined;
  for (const name of ON_PATH) {
    try {
      const found = execFileSync("command", ["-v", name], { encoding: "utf8", shell: "/bin/sh" }).trim();
      if (found && existsSync(found)) return found;
    } catch { /* not on PATH */ }
  }
  return undefined;
}

export function chromePath(): string {
  // An explicit override is an instruction, not a hint: if it names a path
  // that is not there, say so instead of quietly using a different browser
  // than the one that was asked for.
  const told = process.env["CHROME_PATH"];
  if (told) {
    if (!existsSync(told)) throw new Error(`CHROME_PATH is set to ${told}, and there is nothing there`);
    return told;
  }
  const found = CANDIDATES.find((p) => existsSync(p)) ?? fromPath();
  if (!found)
    throw new Error(
      "no Chrome found. Set CHROME_PATH, or install Chrome or Chromium. Looked at: "
      + CANDIDATES.join(", ") + "; and on PATH for: " + ON_PATH.join(", ") + ". "
      + "A run that cannot open a browser has not read the pages that need one, "
      + "and must not report that it has.",
    );
  return found;
}

/**
 * Who is asking, in the string the page sees.
 *
 * The fetcher's own name, carried into Chrome's User-Agent beside Chrome's:
 * a host that blocks this watch must be able to block it by name, and a host
 * that let the browser through on 2026-09-15 saw a string shaped like this
 * one. The browser half stays because a page that renders from a script
 * frequently decides what to render by it.
 */
const WATCH_NAME = "permit-rulebook-watch/0.1";

/** A per-entry budget, the fetcher's own. */
const BUDGET_MS = 30_000;

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

interface Session {
  render(entry: WatchEntry, budgetMs: number): Promise<string>;
  close(): void;
}

const PROFILE_PREFIX = "permit-rulebook-watch-";

/** Distinguishes two browsers opened by one process. */
let nextProfile = 0;

/**
 * Profiles left by runs that are over. A dead pid cannot still be browsing.
 *
 * Windows holds a lock on the profile directory for a moment after the browser
 * is killed, so removing it on the way out only sometimes works — two hours of
 * building this reader left eighteen of them behind on the developer machine
 * (2026-09-23). The runner does not care; a laptop fills up. So the way out
 * still tries, and this is the sweep that always works: at launch, delete the
 * ones whose process is gone. The site's harness does the same, for the same
 * reason.
 */
function sweepStaleProfiles(): void {
  let entries: string[];
  try { entries = readdirSync(tmpdir()); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith(PROFILE_PREFIX)) continue;
    const pid = Number(name.slice(PROFILE_PREFIX.length).split("-")[0]);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    // Signal 0 asks whether the process exists without touching it.
    try { process.kill(pid, 0); continue; } catch { /* gone: sweep it */ }
    try { rmSync(join(tmpdir(), name), { recursive: true, force: true }); } catch { /* still locked */ }
  }
}

/**
 * Chrome, launched headless with a profile of its own and attached to over the
 * DevTools endpoint it prints on stderr.
 *
 * The profile is under the OS temp directory and is removed on the way out;
 * a second instance sharing one profile directory exits 21, which is how three
 * unrelated failures got one cause in the site's harness.
 */
async function launch(executable: string, budgetMs: number): Promise<Session> {
  sweepStaleProfiles();
  // A profile per launch, not per process: Chrome exits 21 when a second
  // instance opens a directory the first one holds, and two readers alive at
  // once in one process is a thing a test does and a future caller may.
  const userDataDir = join(tmpdir(), `${PROFILE_PREFIX}${process.pid}-${nextProfile++}`);
  const chrome: ChildProcess = spawn(executable, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--disable-extensions",
    "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  let socket: WebSocket | undefined;
  /**
   * Everything this launch opened, closed once, however the process leaves.
   *
   * Registered against the process in the same breath as the spawn, and NOT
   * after the handshake below: a Chrome that starts and never reports its
   * endpoint is precisely the case where nothing else will close it, and a
   * hook installed after the `await` would never have been installed at all.
   * A `finally` covers a throw on the happy path and nothing else — not a
   * Ctrl-C, not a crash, not an unexpected error above the reader — and the
   * cost of missing one is not untidiness: a headless Chrome nobody owns goes
   * on holding its profile directory and its memory, and the watch is a job
   * that runs every morning. The site's own harness carries this hook for the
   * same reason.
   */
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    process.off("exit", close);
    for (const signal of SIGNALS) process.off(signal, onSignal);
    try { socket?.close(); } catch { /* already closed */ }
    try { chrome.kill(); } catch { /* already gone */ }
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* still locked: Windows */ }
  };
  // Removed again in `close`, so a process that opens a browser per entry — a
  // test file does — does not accumulate listeners until Node warns of a leak.
  const onSignal = () => { close(); process.exit(130); };
  process.on("exit", close);
  for (const signal of SIGNALS) process.on(signal, onSignal);

  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(
        () => reject(new Error(`Chrome did not report a DevTools endpoint within ${Math.round(budgetMs / 1000)}s`)),
        budgetMs,
      );
      chrome.stderr?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const found = /ws:\/\/[^\s]+/.exec(buffer);
        if (found) { clearTimeout(timer); resolve(found[0]); }
      });
      chrome.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}) before it was ready`)); });
      chrome.on("error", (e) => { clearTimeout(timer); reject(new Error(`Chrome would not start: ${e.message}`)); });
    });

    socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", () => reject(new Error("could not attach to Chrome's DevTools endpoint")), { once: true });
    });
    return attach(socket, close);
  } catch (e) {
    // The browser this call spawned does not outlive the call that failed.
    close();
    throw e;
  }
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** The session over an open DevTools socket — the protocol half of `launch`. */
function attach(socket: WebSocket, close: () => void): Session {

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
  /** Requests each tab has started and not yet finished — one half of what
   * "the page has stopped" means. */
  const inFlight = new Map<string, Set<string>>();
  const requestsOf = (sessionId: string) => {
    const open = inFlight.get(sessionId) ?? new Set<string>();
    inFlight.set(sessionId, open);
    return open;
  };
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number; method?: string; sessionId?: string;
      params?: { type?: string; requestId?: string; response?: { status?: number; url?: string } };
      error?: { message: string }; result?: Record<string, unknown>;
    };
    if (message.sessionId && message.params?.requestId) {
      if (message.method === "Network.requestWillBeSent") requestsOf(message.sessionId).add(message.params.requestId);
      else if (message.method === "Network.loadingFinished" || message.method === "Network.loadingFailed")
        requestsOf(message.sessionId).delete(message.params.requestId);
    }
    if (message.method === "Network.responseReceived" && message.params?.type === "Document" && message.sessionId) {
      const response = message.params.response;
      documentStatus.set(message.sessionId, { status: response?.status ?? 0, url: response?.url ?? "" });
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
    async render(entry, budgetMs) {
      // A tab per entry, closed after it. One tab reused across seven pages
      // carries the previous page's scroll, focus and any state a script left
      // on `window`; a fresh target is what "the page, opened" means.
      const { targetId } = await send("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      const attached: string[] = [];
      try {
        const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }) as { sessionId: string };
        attached.push(sessionId);
        await send("Page.enable", {}, sessionId);
        await send("Runtime.enable", {}, sessionId);
        await send("Network.enable", {}, sessionId);
        const ua = await send("Browser.getVersion") as { userAgent?: string };
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
            throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text ?? "the page threw");
          return answer.result?.value;
        };

        documentStatus.delete(sessionId);
        inFlight.delete(sessionId);
        const stillLoading = () => requestsOf(sessionId).size;
        const navigation = await send("Page.navigate", { url: entry.url }, sessionId) as { errorText?: string };
        // Chrome says here whether it got anywhere. Asking the DOM instead is
        // asking the error page whether it is the page.
        if (navigation.errorText) throw new Error(`the browser could not reach the page: ${navigation.errorText}`);
        await settle(evaluate, stillLoading, budgetMs);
        const served = documentStatus.get(sessionId);
        if (!served) throw new Error("the browser received no document response for this page");
        if (served.status < 200 || served.status >= 300)
          throw new Error(`HTTP ${served.status} in the browser${served.url && served.url !== entry.url ? ` (after redirect to ${served.url})` : ""}`);
        for (const step of entry.steps ?? []) {
          const failure = await evaluate(`(${PERFORM_STEP})(${JSON.stringify(step)})`) as string | null;
          if (failure) throw new Error(failure);
          await settle(evaluate, stillLoading, budgetMs);
        }
        return await evaluate("document.documentElement.outerHTML") as string;
      } finally {
        // The tab goes, and so does everything this run remembered about it:
        // a session id Chrome may reuse must not arrive carrying the previous
        // page's status line or its half-finished requests.
        for (const id of attached) { inFlight.delete(id); documentStatus.delete(id); }
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
 * Its failure mode is bounded and it is the safe one: a page that never stops
 * moving is read when the budget runs out, with whatever it had — which is
 * what a person watching it would do.
 */
async function settle(
  evaluate: (expression: string) => Promise<unknown>,
  inFlight: () => number,
  budgetMs: number,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  await new Promise((r) => setTimeout(r, MIN_SETTLE_MS));
  for (;;) {
    if (Date.now() >= deadline) return;
    const state = await evaluate(
      "JSON.stringify([document.readyState, Date.now() - (window.__watchLastMutation || 0)])",
    ) as string;
    const [readyState, quietFor] = JSON.parse(state) as [string, number];
    if (readyState === "complete" && inFlight() === 0 && quietFor >= QUIET_MS) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Runs in the page, before its own scripts: when did the DOM last move? */
const QUIET_WATCHER = `
window.__watchLastMutation = Date.now();
new MutationObserver(function () { window.__watchLastMutation = Date.now(); })
  .observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
`;

/**
 * One step, performed in the page — the whole vocabulary, in the page's own
 * language, returning the reason it could not be done or `null`.
 *
 * It is a string rather than a function this module calls because it runs in
 * Chrome, not here; it is serialized into `Runtime.evaluate`. The shape it
 * takes is `WatchStep`, and the four arms are the four the validator accepts.
 *
 * **Labels are matched by accessible name**, not by visible text and not by
 * selector. A form control's visible text is frequently nothing at all — a
 * `<select>` shows its chosen option, a radio shows "Yes" — so visible text
 * cannot name the field a step means; its accessible name is exactly what a
 * person is told the control is for, and it is the name the authority commits
 * to when it writes the page. The computation here is a declared subset of
 * ARIA's: `aria-labelledby`, then `aria-label`, then a `<label for>` or a
 * wrapping `<label>`, then the enclosing fieldset's `<legend>`, then the
 * element's own text. Full accname is a specification with a dozen steps and
 * no bearing on the controls these seven pages use.
 *
 * Matching is whitespace-collapsed, case-insensitive containment: the declared
 * label must appear in the accessible name. Containment rather than equality
 * because an authority's own label carries hints and required-markers that the
 * sentence in the watchlist should not have to track; case-insensitive because
 * a CSS text-transform is not a rename. A label that matches more than one
 * control fails rather than picking one — a step that chose between two
 * candidates would read the page in a state nobody declared.
 */
const PERFORM_STEP = `function (step) {
  function norm(s) { return String(s == null ? "" : s).replace(/\\u00a0/g, " ").replace(/\\s+/g, " ").trim().toLowerCase(); }
  // An id is the page's to choose and may hold a quote; unescaped into a
  // selector it throws a DOMException, which surfaces as the page being
  // unreadable rather than as the step it actually is.
  function labelFor(el) {
    if (!el.id) return null;
    return document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
  }
  function accName(el) {
    var by = el.getAttribute && el.getAttribute("aria-labelledby");
    if (by) {
      var parts = by.split(/\\s+/).map(function (id) {
        var n = document.getElementById(id);
        return n ? n.textContent : "";
      });
      if (parts.join(" ").trim()) return parts.join(" ");
    }
    var aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria;
    var lbl = labelFor(el);
    if (lbl && lbl.textContent.trim()) return lbl.textContent;
    var wrapping = el.closest && el.closest("label");
    if (wrapping && wrapping.textContent.trim()) return wrapping.textContent;
    var set = el.closest && el.closest("fieldset");
    if (set) {
      var legend = set.querySelector("legend");
      if (legend && legend.textContent.trim()) return legend.textContent;
    }
    return el.textContent || el.value || "";
  }
  /** Can a person act on this at all? A typeahead keeps a ghost input beside
   * the real one, and the runner met exactly that on ind.nl: two text inputs
   * under one label, only one of them a control. */
  function actionable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.getAttribute("aria-hidden") === "true" || el.closest("[aria-hidden=true]")) return false;
    if (el.hidden || el.closest("[hidden]")) return false;
    var box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }
  function named(selector, label, what) {
    var wanted = norm(label);
    var hits = [].slice.call(document.querySelectorAll(selector)).filter(function (el) {
      return norm(accName(el)).indexOf(wanted) >= 0;
    });
    if (hits.length === 0) return { error: what + ' "' + label + '" is not on the page' };
    // Several is usually one control and its scaffolding, so the ones nobody
    // could act on are dropped before calling it ambiguous.
    if (hits.length > 1) {
      var live = hits.filter(actionable);
      if (live.length === 1) return { el: live[0] };
      if (live.length > 1) {
        // Still several. A typeahead's real input is the one that says it
        // opens something — a role, an autocomplete hint, a list it controls —
        // and its twin says none of that. Preferring it beats failing when the
        // page has told us which is which.
        var declared = live.filter(function (el) {
          return el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")
            || el.getAttribute("aria-controls") || el.getAttribute("aria-owns")
            || el.getAttribute("aria-expanded") || el.getAttribute("list");
        });
        if (declared.length === 1) return { el: declared[0] };
        return { error: what + ' "' + label + '" matches ' + live.length + " controls on the page: " + shapes(live) };
      }
      return { error: what + ' "' + label + '" matches ' + hits.length + " things, none of them a control: " + shapes(hits) };
    }
    return { el: hits[0] };
  }
  /** What a set of elements IS, for a message that has to diagnose from afar. */
  function shapes(list) {
    return list.map(function (e) {
      var role = e.getAttribute("role");
      return e.tagName + (e.type ? "[type=" + e.type + "]" : "") + (role ? "[role=" + role + "]" : "");
    }).join(", ");
  }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  /**
   * Set an input's value the way a keystroke does.
   *
   * Assigning to '.value' is invisible to React and to anything else that
   * wraps the property with its own setter: the framework's state never
   * changes, so its listener never runs and no suggestion is ever requested.
   * Calling the prototype's own setter underneath it is what makes the
   * following 'input' event carry the text.
   */
  function nativeValue(el, text) {
    var proto = Object.getPrototypeOf(el);
    var setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, text);
    else el.value = text;
  }
  /**
   * Poll a page-side check until it succeeds or the step runs out of patience.
   *
   * A typeahead answers on a timer — ind.nl's does — so "is the option there?"
   * asked once, immediately after typing, always answers no. The last reading
   * is handed back either way, so a failure can say what WAS on offer rather
   * than only that the option was not.
   */
  function waitFor(check) {
    var deadline = Date.now() + 5000;
    return new Promise(function (resolve) {
      (function attempt() {
        var reading = check();
        if (reading.pick || Date.now() >= deadline) { resolve(reading); return; }
        window.setTimeout(attempt, 100);
      })();
    });
  }
  /** The first few things on offer, so a wrong option says what the right ones are. */
  function offered(list) {
    var words = list.map(function (o) { return JSON.stringify(String(o.textContent || o.value || "").trim().slice(0, 40)); });
    return words.length ? words.slice(0, 6).join(", ") + (words.length > 6 ? ", ..." : "") : "nothing";
  }
  /**
   * What is actually near this label, for a step that could not act on it.
   *
   * The runner is the only machine that meets some of these pages, and there
   * is no devtools window on it: a step that fails saying only "not on the
   * page" costs another dispatch to find out what IS there. So the failure
   * carries the shape it met — the tag, the role, a bounded excerpt — and the
   * error becomes the diagnosis (s34, 2026-09-23).
   */
  function near(label) {
    var wanted = norm(label);
    var holder = [].slice.call(document.querySelectorAll("h1,h2,h3,h4,label,legend,p,span,div,button"))
      .filter(function (e) { return norm(e.textContent).indexOf(wanted) >= 0; })
      .pop();
    if (!holder) return " (and no element on the page carries that text at all)";
    var scope = holder.parentNode || holder;
    var shapes = [].slice.call(scope.querySelectorAll("select,input,button,textarea,[role]"))
      .slice(0, 8)
      .map(function (e) {
        var role = e.getAttribute("role");
        return e.tagName
          + (e.type ? "[type=" + e.type + "]" : "")
          + (role ? "[role=" + role + "]" : "")
          + (e.getAttribute("aria-expanded") ? "[aria-expanded=" + e.getAttribute("aria-expanded") + "]" : "");
      });
    return " — near that label the page has: " + (shapes.length ? shapes.join(", ") : "no control at all")
      + '; the text there reads "' + norm(scope.textContent).slice(0, 160) + '"';
  }

  if (step.step === "select") {
    var wantedOption = norm(step.option);
    // A native select first, because when a page has one there is nothing to
    // open and nothing to guess.
    var native = named("select", step.field, "the field");
    if (!native.error) {
      var options = [].slice.call(native.el.options).filter(function (o) { return norm(o.textContent) === wantedOption || norm(o.value) === wantedOption; });
      if (options.length !== 1) return 'step select: the option "' + step.option + '" is not in the field "' + step.field + '" (it offers: ' + offered([].slice.call(native.el.options)) + ")";
      native.el.value = options[0].value;
      fire(native.el, "input");
      fire(native.el, "change");
      return null;
    }
    // Otherwise whatever the page did build: a control that says it is a
    // combobox, one that owns a listbox, or a plain text box — which is what
    // ind.nl builds, measured from the runner on 2026-09-23. A person reaches
    // the options the same way in all three: make the control show them, then
    // pick the one whose words match.
    var combo = named(
      "[role=combobox], [role=listbox], [aria-haspopup=listbox], input[type=text], input:not([type])",
      step.field, "the field");
    if (combo.error) return "step select: " + combo.error + near(step.field);

    /** Wherever this control keeps its options, once it has any. */
    function optionsOf(el) {
      var listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      var list = (listId && document.getElementById(listId))
        || (el.getAttribute("role") === "listbox" ? el : null)
        || (el.parentNode && el.parentNode.querySelector("[role=listbox]"))
        || (el.closest("div, fieldset, form") || document).querySelector("[role=listbox], ul[class*=autocomplete], ul[class*=suggest]");
      if (!list || list.hidden) return [];
      var found = [].slice.call(list.querySelectorAll("[role=option], li"));
      return found.filter(function (o) { return o.offsetParent !== null || list === el; });
    }

    var isTextBox = combo.el.tagName === "INPUT" && combo.el.type !== "hidden";
    if (isTextBox) {
      // Nothing exists to pick until something is typed, so type it — the way
      // a person does, letting the page's own listener build the list — then
      // wait for the list, because it is built on a timer and reading the DOM
      // the instant after typing finds nothing at all.
      combo.el.focus();
      nativeValue(combo.el, step.option);
      fire(combo.el, "input");
      combo.el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: step.option.slice(-1) }));
    } else if (combo.el.getAttribute("aria-expanded") === "false") {
      combo.el.click();
    }

    return waitFor(function () {
      var options = optionsOf(combo.el);
      var picks = options.filter(function (o) { return norm(o.textContent) === wantedOption; });
      if (picks.length === 1) return { pick: picks[0] };
      // Not yet, or never: only the deadline tells the two apart.
      return { offers: options };
    }).then(function (last) {
      if (last.pick) { last.pick.click(); return null; }
      var what = last.offers.length
        ? "it offers: " + offered(last.offers)
        : (isTextBox ? "typing it offered nothing" : "it offered nothing");
      return 'step select: the option "' + step.option + '" is not in the field "'
        + step.field + '" (' + what + ")" + (last.offers.length ? "" : near(step.field));
    });
  }
  if (step.step === "answer") {
    var group = named("fieldset, [role=radiogroup]", step.question, "the question");
    if (group.error) return "step answer: " + group.error + near(step.question);
    var wantedAnswer = step.answer === "yes" ? "yes" : "no";
    var radios = [].slice.call(group.el.querySelectorAll('input[type=radio]')).filter(function (r) {
      var own = r.closest("label");
      var text = own ? own.textContent : (labelFor(r) || {}).textContent;
      return norm(text) === wantedAnswer || norm(r.value) === wantedAnswer;
    });
    if (radios.length !== 1) return 'step answer: "' + step.question + '" has no single "' + step.answer + '" to choose';
    // Pressing it is what a person does, and it does the lot natively: sets
    // checked, then fires click, input and change in the order a listener
    // expects. Setting the property and dispatching the events by hand got
    // that order wrong and left a framework's own handler unrun. No backtick
    // in this comment, or any other inside PERFORM_STEP: the page script is a
    // template literal, and one would end it here.
    radios[0].click();
    return null;
  }
  if (step.step === "press") {
    var button = named("button, input[type=submit], input[type=button], a[role=button], [role=button]", step.button, "the button");
    if (button.error) return "step press: " + button.error + near(step.button);
    button.el.click();
    return null;
  }
  if (step.step === "expand") {
    // Only a declared disclosure: a <details>, or a control that says both
    // that it is closed and what it opens. Clicking everything that merely
    // carries aria-expanded would open the site's own navigation menu, which
    // is not a collapsed block of the text being read.
    [].slice.call(document.querySelectorAll("details")).forEach(function (d) { d.open = true; });
    [].slice.call(document.querySelectorAll('[aria-expanded="false"][aria-controls]')).forEach(function (el) { el.click(); });
    return null;
  }
  return 'step "' + step.step + '" is not one this reader knows';
}`;

/** Re-exported so a caller building a watchlist entry has the vocabulary to
 * hand without reaching past this module for it. */
export type { WatchStep };
