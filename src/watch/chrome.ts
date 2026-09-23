import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, type Session } from "./cdp.js";

/**
 * Where Chrome is, the profile it runs in, and starting it and putting it
 * away. Nothing here knows what a watch entry is. See `browser.ts` for how
 * the four files fit together.
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
export async function launch(executable: string, budgetMs: number): Promise<Session> {
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
