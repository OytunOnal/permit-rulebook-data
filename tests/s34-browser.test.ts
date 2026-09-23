import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromePath, openBrowserReader } from "../src/watch/browser.js";
import { runWatch, type Fetcher, type WatchEntry } from "../src/watch/core.js";
import type { WatchState } from "../src/watch/state.js";

/**
 * s34 — the reader itself, driving a real Chrome over a page this file serves.
 *
 * Everything else in the slice stubs the browser, which is honest about what
 * it tests and says nothing about whether a browser can be opened at all,
 * whether a label can be found, or whether a page that renders its rules from
 * a script is ever read. This case is the one that does, and it is the case
 * that de-mocks that stub: the fixture below is the IND's form in miniature —
 * three questions, a *View information* button that renders the requirement
 * list only once they are answered, and a collapsed block holding a sentence
 * a reader who never opens it never sees.
 *
 * Where there is no Chrome it skips and says so out loud — but never under CI,
 * where a skip is how a promise quietly stops being kept.
 */

const CI = Boolean(process.env["CI"]);
let noChrome: string | undefined;
try { chromePath(); } catch (e) { noChrome = String(e instanceof Error ? e.message : e); }
if (noChrome && !CI) console.log(`s34: the real-browser cases are SKIPPED — ${noChrome}`);

const TURKIYE = "Türkiye";

/**
 * The IND's form in miniature: nothing operative is in the markup a fetch
 * would receive, and every answer is required before the list renders.
 */
function fixture({ nationalityField = true } = {}): string {
  const nationality = nationalityField
    ? `<label for="nat">What is your nationality?</label>
  <select id="nat"><option value="">Choose</option><option>Germany</option><option>${TURKIYE}</option></select>`
    : "";
  const script = [
    'document.getElementById("view").addEventListener("click", function () {',
    '  var nat = document.getElementById("nat");',
    '  var valid = document.querySelector("input[name=valid]:checked");',
    '  var expired = document.querySelector("input[name=expired]:checked");',
    '  if (!nat || !nat.value || !valid || !expired) return;',
    `  if (nat.value !== ${JSON.stringify(TURKIYE)} || valid.value !== "no" || expired.value !== "no") return;`,
    '  document.getElementById("result").innerHTML =',
    '    "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>"',
    '    + "<button type=\\"button\\" id=\\"more\\" aria-expanded=\\"false\\" aria-controls=\\"details\\">Show details</button>"',
    '    + "<div id=\\"details\\"></div>";',
    // The collapsed block renders its sentence when it is opened and not
    // before, the way the orientation-year page does: a reader who never
    // opens it never sees the sentence, and neither does the page's HTML.
    '  document.getElementById("more").addEventListener("click", function () {',
    '    this.setAttribute("aria-expanded", "true");',
    '    document.getElementById("details").textContent = "A provisional residence permit (MVV) is needed.";',
    "  });",
    "});",
  ].join("\n");
  return `<!doctype html><html lang="en"><head><title>Fixture route</title></head><body>
<h1>Fixture route</h1>
<p>Last update: 23 September 2026</p>
<p>Lede: what this permit is for.</p>
<form id="situation">
  <h2>Your situation</h2>
  ${nationality}
  <fieldset><legend>Do you already have a valid Dutch residence permit?</legend>
    <label><input type="radio" name="valid" value="yes"> Yes</label>
    <label><input type="radio" name="valid" value="no"> No</label>
  </fieldset>
  <fieldset><legend>Did you have a Dutch residence permit and did it expire less than 2 years ago? And do you still live in the Netherlands?</legend>
    <label><input type="radio" name="expired" value="yes"> Yes</label>
    <label><input type="radio" name="expired" value="no"> No</label>
  </fieldset>
  <button type="button" id="view">View information</button>
</form>
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
<script>${script}</script>
</body></html>`;
}

/**
 * A page whose shell carries both slice markers and whose rules land later —
 * ind.nl's shape, in miniature and on a timer.
 */
function lateFixture(afterMs: number): string {
  return `<!doctype html><html lang="en"><head><title>Late route</title></head><body>
<p>Last update: 23 September 2026</p>
<p>Lede: what this permit is for.</p>
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
<script>setTimeout(function () {
  document.getElementById("result").innerHTML =
    "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>";
}, ${afterMs});</script>
</body></html>`;
}

let served = fixture();
let status = 200;
const server: Server = createServer((_req, res) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(served);
});
await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => resolve()); });
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
afterAll(() => { server.close(); });

/** The recipe `data/verify-s5e.md` §3 writes down for a person, as steps. */
const RECIPE: WatchEntry["steps"] = [
  { step: "select", field: "What is your nationality?", option: TURKIYE },
  { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
  { step: "answer", question: "Did you have a Dutch residence permit and did it expire less than 2 years ago?", answer: "no" },
  { step: "press", button: "View information" },
  { step: "expand" },
];

const entry = (overrides: Partial<WatchEntry> = {}): WatchEntry => ({
  id: "fixture-route",
  url: origin,
  strategy: "browser",
  kind: "sentinel",
  steps: RECIPE,
  slice: { from: "Lede:", to: "Cookies Proclaimer" },
  ...overrides,
});

const refuse: Fetcher = async () => ({ ok: false, error: "nothing here is fetched" });
const emptyState: WatchState = { entries: {} };

describe.skipIf(Boolean(noChrome) && !CI)("s34 — a real browser performs the steps and hands back the rendered page", () => {
  it("reads a requirement list that exists only after the form is answered", async () => {
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      const text = nextState.entries["fixture-route"]!.text!;
      // The sentence the script renders, which no fetch of this page carries.
      expect(text).toContain("You meet the general requirements that apply to everyone.");
      // The one behind the collapsed block, which `expand` opened.
      expect(text).toContain("A provisional residence permit (MVV) is needed.");
      // The slice held: the page's own "Last update" line sits above it.
      expect(text.startsWith("Lede:")).toBe(true);
      expect(text).not.toContain("Last update");
    } finally { await reader.close(); }
  });

  it("without the expand step, the sentence in the collapsed block is not read", async () => {
    // The assertion above would pass on a page that merely hides the block
    // with CSS, because the words would be in the HTML either way. This is
    // what makes `expand` load-bearing rather than decorative.
    const reader = openBrowserReader();
    try {
      const unopened = entry({ steps: RECIPE.slice(0, -1) });
      const { nextState } = await runWatch({ entries: [unopened] }, emptyState, refuse, "2026-09-23", reader.read);
      const text = nextState.entries["fixture-route"]!.text!;
      expect(text).toContain("You meet the general requirements that apply to everyone.");
      expect(text).not.toContain("A provisional residence permit (MVV) is needed.");
    } finally { await reader.close(); }
  });

  it("reports unreachable and names the step when the form loses its nationality field", async () => {
    served = fixture({ nationalityField: false });
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error).toMatch(/What is your nationality\?/);
      expect(reports[0]!.error).toMatch(/select/);
      // Nothing was written: a page read in a state nobody chose is not a
      // reading, and the snapshot that stands is better than a wrong one.
      expect(nextState.entries["fixture-route"]).toBeUndefined();
    } finally { await reader.close(); served = fixture(); }
  });

  it("waits for a page that renders its rules late, instead of reading the shell", async () => {
    // Measured against ind.nl on 2026-09-23: the shell a fetch receives
    // carries the page's lede AND its footer — both slice markers — and the
    // requirement list arrives afterwards. A reader that stops at the first
    // lull therefore slices a 663-character shell out of a 14,600-character
    // page, hashes it, and reports the authority as having rewritten
    // everything. Reading early is not a slow read, it is a wrong one.
    served = lateFixture(1500);
    const reader = openBrowserReader();
    try {
      const late = entry({ steps: [], slice: { from: "Lede:", to: "Cookies Proclaimer" } });
      const { nextState } = await runWatch({ entries: [late] }, emptyState, refuse, "2026-09-23", reader.read);
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("refuses a page the server answered with an error status", async () => {
    // A browser renders an error page as willingly as a good one, and its
    // words are words: 404's "not found" would be hashed, compared and
    // reported as the page having changed. The fetcher refuses a bad status
    // and so must this reader, or the two arms disagree about what a reading
    // is.
    status = 404;
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch({ entries: [entry()] }, emptyState, refuse, "2026-09-23", reader.read);
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error).toMatch(/404/);
    } finally { await reader.close(); status = 200; }
  });

  it("refuses a page Chrome could not reach at all, rather than reading its error page", async () => {
    // Measured on 2026-09-23: a network blip mid-run handed this reader
    // Chromium's own ERR_NETWORK_CHANGED page — 185 kB of markup, 127
    // characters of text — as a perfectly successful read. Navigation says
    // whether it worked; the DOM does not.
    const reader = openBrowserReader({ budgetMs: 15_000 });
    try {
      const { reports } = await runWatch(
        { entries: [entry({ url: "http://127.0.0.1:1/", slice: undefined, steps: [] })] },
        emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error, "the error does not say what the navigation did").toMatch(/ERR_|navigat/i);
    } finally { await reader.close(); }
  });

  it("reads the same page twice into the same text, so rendering is not itself a change", async () => {
    const reader = openBrowserReader();
    try {
      const once = await runWatch({ entries: [entry()] }, emptyState, refuse, "2026-09-23", reader.read);
      const twice = await runWatch({ entries: [entry()] }, once.nextState, refuse, "2026-09-24", reader.read);
      expect(twice.reports[0]!.outcome, twice.reports[0]!.error).toBe("unchanged");
    } finally { await reader.close(); }
  });
});

describe.skipIf(Boolean(noChrome) && !CI)("s34 — two readers in one process do not fight over one browser profile", () => {
  it("opens both and reads the page with each", async () => {
    // Chrome exits 21 when a second instance opens a profile directory the
    // first one holds, and a directory named after the process alone is the
    // same directory for every reader in it. In the site's harness that read
    // as three unrelated test failures with one cause; here it would read as
    // "the runner has no browser".
    const first = openBrowserReader();
    const second = openBrowserReader();
    try {
      const a = await first.read(entry({ steps: [] }));
      const b = await second.read(entry({ steps: [] }));
      expect(a.ok, a.ok ? "" : a.error).toBe(true);
      expect(b.ok, b.ok ? "" : b.error).toBe(true);
    } finally { await first.close(); await second.close(); }
  });
});

describe("s34 — a reader that can find no Chrome says so and reads nothing", () => {
  it("answers every browser entry with an error that names the browser", async () => {
    const reader = openBrowserReader({
      chromeAt: () => { throw new Error("no Chrome found. Set CHROME_PATH, or install Chrome or Chromium."); },
    });
    try {
      const { reports } = await runWatch({ entries: [entry()] }, emptyState, refuse, "2026-09-23", reader.read);
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error).toMatch(/Chrome/);
    } finally { await reader.close(); }
  });
});
