import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromePath, openBrowserReader } from "../src/watch/browser.js";
import { MOST_OF_AN_ADDRESS } from "../src/watch/fetch-source.js";
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

/**
 * What each server was told about who is asking, so the promise can be
 * measured rather than described.
 *
 * `acrh` is the one that matters most: an `Access-Control-Request-Headers`
 * line means Chrome sent a preflight, which means the request was not simple,
 * which means this watch changed what the page does rather than watching it.
 */
interface Introduction {
  method: string;
  path: string;
  named: boolean;
  contact: string | undefined;
  acrh: string | undefined;
}
const metElsewhere: Introduction[] = [];
const metAtSource: Introduction[] = [];
const introduction = (req: {
  method?: string; url?: string; headers: Record<string, string | string[] | undefined>;
}): Introduction => ({
  method: req.method ?? "",
  path: (req.url ?? "").split("?")[0] ?? "",
  named: String(req.headers["user-agent"] ?? "").includes("permit-rulebook-watch"),
  contact: req.headers["x-source-contact"] as string | undefined,
  acrh: req.headers["access-control-request-headers"] as string | undefined,
});

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
 * The same form, with the nationality control built the way a design system
 * builds one: a button that opens a listbox, not a `<select>`.
 *
 * ind.nl's own control is not a native select — no option text appears in the
 * shell the runner rendered — and a step that can only drive `<select>` would
 * report the field missing on a page that plainly has it. What a person does
 * here is what the step must do: open the thing, pick the option by the words
 * on it.
 */
function comboFixture(): string {
  const script = [
    'var toggle = document.getElementById("nat-toggle");',
    'var list = document.getElementById("nat-list");',
    'var chosen = null;',
    'toggle.addEventListener("click", function () {',
    '  var open = this.getAttribute("aria-expanded") === "true";',
    '  this.setAttribute("aria-expanded", String(!open));',
    '  list.hidden = open;',
    '});',
    'list.addEventListener("click", function (e) {',
    '  if (e.target.getAttribute("role") !== "option") return;',
    '  chosen = e.target.textContent.trim();',
    '  toggle.textContent = chosen;',
    '  toggle.setAttribute("aria-expanded", "false");',
    '  list.hidden = true;',
    '});',
    'document.getElementById("view").addEventListener("click", function () {',
    '  var valid = document.querySelector("input[name=valid]:checked");',
    `  if (chosen !== ${JSON.stringify(TURKIYE)} || !valid || valid.value !== "no") return;`,
    '  document.getElementById("result").innerHTML =',
    '    "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>";',
    "});",
  ].join("\n");
  return `<!doctype html><html lang="en"><head><title>Combo route</title></head><body>
<p>Lede: what this permit is for.</p>
<h2 id="nat-label">What is your nationality?</h2>
<button type="button" id="nat-toggle" role="combobox" aria-expanded="false"
        aria-controls="nat-list" aria-labelledby="nat-label">Choose</button>
<ul id="nat-list" role="listbox" hidden>
  <li role="option">Germany</li>
  <li role="option">${TURKIYE}</li>
</ul>
<fieldset><legend>Do you already have a valid Dutch residence permit?</legend>
  <label><input type="radio" name="valid" value="yes"> Yes</label>
  <label><input type="radio" name="valid" value="no"> No</label>
</fieldset>
<button type="button" id="view">View information</button>
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
<script>${script}</script>
</body></html>`;
}

/**
 * The nationality field as ind.nl actually builds it: a typeahead.
 *
 * Measured from the runner, 2026-09-23 (dispatch 35907509394). The failing
 * step reported "near that label the page has: INPUT[type=text],
 * INPUT[type=text]" — no select, and no listbox anywhere in the document. So
 * there is nothing to open and nothing to pick until something is typed, and
 * the suggestions are built out of the typing. Two inputs, because that is
 * what the runner found: the one a person types in, and the ghost a typeahead
 * keeps beside it.
 *
 * `suggests: false` is the same control offering something else, which is the
 * shape of the day the IND renames a country or drops one.
 */
function typeaheadFixture({ suggests = true, keysOnly = false } = {}): string {
  // `suggests: false` offers the near miss rather than something unrelated:
  // a list that answers the typing and does not hold the word asked for is
  // the shape of the day an authority renames an option — and it is the shape
  // ind.nl actually had, where the list held "Turkish" and the entry asked
  // for "Türkiye".
  const offers = suggests ? [TURKIYE, "Tunisia", "Turkmenistan"] : ["Turkey", "Turkmenistan"];
  const script = [
    `var OFFERS = ${JSON.stringify(offers)};`,
    'var input = document.getElementById("nat");',
    'var box = document.getElementById("nat-sugg");',
    'var chosen = null;',
    // `keysOnly` is the shape ind.nl turned out to be: a control that answers
    // a keystroke and ignores a value written into it. A page-side setter
    // plus a synthetic `input` event cannot drive this fixture at all, which
    // is what makes the case below a proof about real key events.
    ...(keysOnly ? ['var sawKey = false;', 'input.addEventListener("keydown", function () { sawKey = true; });'] : []),
    'input.addEventListener("input", function () {',
    ...(keysOnly ? ['  if (!sawKey) return;'] : []),
    '  var typed = input.value.trim().toLowerCase();',
    '  window.clearTimeout(window.__t);',
    // Suggestions arrive on a timer, as a real typeahead's do: a step that
    // reads the DOM the instant it has typed finds nothing at all.
    '  window.__t = window.setTimeout(function () {',
    '    box.innerHTML = "";',
    '    var hits = typed ? OFFERS.filter(function (n) { return n.toLowerCase().indexOf(typed) === 0; }) : [];',
    '    hits.forEach(function (n) {',
    '      var li = document.createElement("li");',
    '      li.setAttribute("role", "option");',
    '      li.textContent = n;',
    '      li.addEventListener("click", function () {',
    '        chosen = n; input.value = n; box.hidden = true;',
    '        input.setAttribute("aria-expanded", "false");',
    '      });',
    '      box.appendChild(li);',
    '    });',
    '    box.hidden = hits.length === 0;',
    '    input.setAttribute("aria-expanded", String(hits.length > 0));',
    '  }, 150);',
    '});',
    'document.getElementById("view").addEventListener("click", function () {',
    '  var valid = document.querySelector("input[name=valid]:checked");',
    `  if (chosen !== ${JSON.stringify(TURKIYE)} || !valid || valid.value !== "no") return;`,
    '  document.getElementById("result").innerHTML =',
    '    "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>";',
    "});",
  ].join("\n");
  return `<!doctype html><html lang="en"><head><title>Typeahead route</title></head><body>
<p>Lede: what this permit is for.</p>
<div class="field">
  <label for="nat">What is your nationality?</label>
  <input id="nat" type="text" role="combobox" aria-expanded="false" aria-controls="nat-sugg" autocomplete="off">
  <input type="text" class="ghost" tabindex="-1" readonly aria-hidden="true">
  <ul id="nat-sugg" role="listbox" hidden></ul>
</div>
<fieldset><legend>Do you already have a valid Dutch residence permit?</legend>
  <label><input type="radio" name="valid" value="yes"> Yes</label>
  <label><input type="radio" name="valid" value="no"> No</label>
</fieldset>
<button type="button" id="view">View information</button>
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
/** When set, the entry address answers a redirect to here instead of a page. */
let redirectTo: string | undefined;
/** What the subframe's own document answers with. */
let frameStatus = 200;
/** When set, the entry address bounces once through a sub-path and back —
 * the Opportunity Card's cookie check, in miniature. */
let bounceOnce = false;
const server: Server = createServer((req, res) => {
  metAtSource.push(introduction(req));
  const path = (req.url ?? "/").split("?")[0]!;
  // A subresource that never answers, for the case that asks whether a
  // paused request can outlast the read's budget.
  if (path === "/never") return;
  if (redirectTo && path === "/") {
    res.writeHead(302, { location: redirectTo });
    res.end();
    return;
  }
  if (bounceOnce && path === "/") {
    res.writeHead(302, { location: "/cookie-check" });
    res.end();
    return;
  }
  if (bounceOnce && path === "/cookie-check") {
    res.writeHead(302, { location: "/" });
    bounceOnce = false;
    res.end();
    return;
  }
  // A subframe, and a request the page's own content waits on. Between them
  // they are the measurement the frame-scoping finding was made with.
  if (path === "/frame") {
    res.writeHead(frameStatus, { "content-type": "text/html; charset=utf-8" });
    res.end("<p>A consent widget, or an embed. Not the authority.</p>");
    return;
  }
  if (path === "/slow-content") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("You meet the general requirements that apply to everyone.");
    }, 4_000);
    return;
  }
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
      const a = await first.read(entry({ steps: [] }), "same-origin");
      const b = await second.read(entry({ steps: [] }), "same-origin");
      expect(a.ok, a.ok ? "" : a.error).toBe(true);
      expect(b.ok, b.ok ? "" : b.error).toBe(true);
    } finally { await first.close(); await second.close(); }
  });
});

describe.skipIf(Boolean(noChrome) && !CI)("s34 — the select step drives whatever the page actually built", () => {
  const combo = (): WatchEntry => entry({
    slice: { from: "Requirements", to: "Cookies Proclaimer" },
    steps: [
      { step: "select", field: "What is your nationality?", option: TURKIYE },
      { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
      { step: "press", button: "View information" },
    ],
  });

  it("opens an ARIA combobox and picks the option by the words on it", async () => {
    served = comboFixture();
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [combo()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("names what it found near the label when it cannot drive the field, so the error is the diagnosis", async () => {
    // The runner is the only machine that sees ind.nl's real form, and we do
    // not get to open a devtools window on it. So a step that fails has to
    // come back with the shape it met — the tag, the role, a bounded excerpt —
    // or the next move is another dispatch to find out what is there.
    served = comboFixture().replace('role="combobox"', 'role="spinbutton"');
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch(
        { entries: [combo()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      const error = reports[0]!.error!;
      expect(error, "the step is not named").toMatch(/select/);
      expect(error, "the label is not named").toMatch(/What is your nationality\?/);
      // The diagnosis: what IS there, close enough to the label to be the thing.
      expect(error, "the error names no tag it found").toMatch(/BUTTON/i);
      expect(error, "the error names no role it found").toMatch(/spinbutton/);
    } finally { await reader.close(); served = fixture(); }
  });
});

describe.skipIf(Boolean(noChrome) && !CI)("s34 — the select step drives a typeahead", () => {
  const typed = (): WatchEntry => entry({
    slice: { from: "Requirements", to: "Cookies Proclaimer" },
    steps: [
      { step: "select", field: "What is your nationality?", option: TURKIYE },
      { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
      { step: "press", button: "View information" },
    ],
  });

  it("types the option, waits for the suggestions, and picks the one that matches", async () => {
    served = typeaheadFixture();
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [typed()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("drives a control that answers keystrokes and ignores a value written into it", async () => {
    // Not ind.nl's shape — that run's "offered nothing" turned out to be the
    // reader looking in the wrong menu, and the suggestions had been arriving
    // all along. This is the case that earns the key events on their own
    // terms: a control that listens for keys and ignores a value written into
    // it cannot be driven any other way, and this fixture is exactly that, so
    // passing it is a claim about real key events and nothing else.
    served = typeaheadFixture({ keysOnly: true });
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [typed()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("finds the field's own menu on a page that has another, shut and empty", async () => {
    // The bug this slice spent five runs and a fifth render on. ind.nl carries
    // two jQuery UI menus: the site search box's, which sits in the document
    // empty and shut, and the nationality field's, which has the answers in
    // it. Asking the document for the FIRST menu got the search box's, found
    // it shut, and reported that the field had offered nothing — while the
    // suggestions were in the second one (2026-09-23).
    //
    // Faithful in the part that matters: the input points at NOTHING — no
    // aria-controls, no aria-owns, which is what jQuery UI leaves behind — so
    // the menu can only be found by looking for menus, and the first one the
    // document offers is the wrong one.
    const script = [
      'var input = document.getElementById("nat"), box = document.getElementById("nat-menu"), chosen = null;',
      'input.addEventListener("input", function () {',
      '  var typed = input.value.trim().toLowerCase();',
      '  box.innerHTML = "";',
      '  if (!typed) { box.style.display = "none"; return; }',
      '  ["Turkish", "Turkmen"].filter(function (n) { return n.toLowerCase().indexOf(typed) >= 0; })',
      '    .forEach(function (n) {',
      '      var item = document.createElement("li");',
      '      var link = document.createElement("a");',
      '      link.textContent = n;',
      '      link.addEventListener("click", function () { chosen = n; input.value = n; box.style.display = "none"; });',
      '      item.appendChild(link); box.appendChild(item);',
      '    });',
      '  box.style.display = box.children.length ? "block" : "none";',
      '});',
      'document.getElementById("view").addEventListener("click", function () {',
      '  var valid = document.querySelector("input[name=valid]:checked");',
      '  if (chosen !== "Turkish" || !valid || valid.value !== "no") return;',
      '  document.getElementById("result").innerHTML =',
      '    "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>";',
      "});",
    ].join("\n");
    served = `<!doctype html><html lang="en"><head><title>Two menus</title></head><body>
<p>Lede: what this permit is for.</p>
<input type="text" aria-label="Search for"><ul id="search-menu" class="ui-autocomplete" style="display:none"></ul>
<label for="nat">What is your nationality?</label>
<input id="nat" type="text" autocomplete="off">
<ul id="nat-menu" class="ui-autocomplete" style="display:none"></ul>
<fieldset><legend>Do you already have a valid Dutch residence permit?</legend>
  <label><input type="radio" name="valid" value="yes"> Yes</label>
  <label><input type="radio" name="valid" value="no"> No</label>
</fieldset>
<button type="button" id="view">View information</button>
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
<script>${script}</script>
</body></html>`;
    const reader = openBrowserReader();
    try {
      // This page offers adjectives, as ind.nl's does.
      const adjective = entry({
        slice: { from: "Requirements", to: "Cookies Proclaimer" },
        steps: [
          { step: "select", field: "What is your nationality?", option: "Turkish" },
          { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
          { step: "press", button: "View information" },
        ],
      });
      const { reports, nextState } = await runWatch(
        { entries: [adjective] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("names what did appear when the option is not among the suggestions", async () => {
    // This control answers — with other countries — so the message must carry
    // what it answered with, which is the half a reader of a red run needs.
    served = typeaheadFixture({ suggests: false });
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch(
        { entries: [typed()] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      const error = reports[0]!.error!;
      // The decision, not the sentence: a failure names the step it was, the
      // label it acted on, and the option it wanted. What it offered instead
      // is asserted where there IS something to offer — below — rather than
      // by matching the words this message happens to use for emptiness.
      expect(error, "the step is not named").toMatch(/select/);
      expect(error, "the option typed is not named").toContain(TURKIYE);
      expect(error, "the field is not named").toContain("What is your nationality?");
      for (const offered of ["Turkey", "Turkmenistan"])
        expect(error, `the error does not say the page offered ${offered}`).toContain(offered);
    } finally { await reader.close(); served = fixture(); }
  });
});

/**
 * The IND's form as a real browser showed it on 2026-09-23, in miniature.
 *
 * Every shape in here was read off the live page rather than imagined, and
 * each one had already broken a run: the nationality list holds ADJECTIVES
 * and renders them as links, not options; the two permit questions are native
 * radios whose visible label is what a person hits, not the input; the third
 * question appears only once the second is answered and the submit button only
 * once the third is; and a "Show details" disclosure below the requirement
 * list holds a sentence nobody sees who does not open it.
 */
function indFormFixture(): string {
  const script = [
    'var input = document.getElementById("nat"), box = document.getElementById("sugg"), chosen = null;',
    'input.addEventListener("input", function () {',
    '  var typed = input.value.trim().toLowerCase();',
    '  box.innerHTML = "";',
    '  if (!typed) { box.hidden = true; return; }',
    '  ["Turkish", "Turkmen", "Tunisian"].filter(function (n) { return n.toLowerCase().indexOf(typed) >= 0; })',
    '    .forEach(function (n) {',
    '      var item = document.createElement("li");',
    '      var link = document.createElement("a");',
    '      link.textContent = n;',
    '      link.addEventListener("click", function () { chosen = n; input.value = n; box.hidden = true; });',
    '      item.appendChild(link); box.appendChild(item);',
    '    });',
    '  box.hidden = !box.children.length;',
    '});',
    // Question three exists only once question two is answered, and the
    // button only once question three is.
    'document.querySelectorAll("#q2 input").forEach(function (radio) {',
    '  radio.addEventListener("click", function () {',
    '    document.getElementById("q3holder").innerHTML =',
    '      \'<fieldset id="q3"><legend>Did you have a Dutch residence permit and did it expire less than 2 years ago?</legend>\'',
    '      + \'<label><input type="radio" name="e" value="yes"> Yes</label>\'',
    '      + \'<label><input type="radio" name="e" value="no"> No</label></fieldset>\';',
    '    document.querySelectorAll("#q3 input").forEach(function (third) {',
    '      third.addEventListener("click", function () {',
    '        document.getElementById("submitholder").innerHTML =',
    '          \'<button type="submit" id="view">View information</button>\';',
    '        document.getElementById("view").addEventListener("click", function () {',
    `          if (chosen !== "Turkish") return;`,
    '          document.getElementById("result").innerHTML =',
    '            "<h2>Requirements</h2><p>You meet the general requirements that apply to everyone.</p>"',
    '            + \'<button type="button" id="more" aria-expanded="false" aria-controls="det">Show details</button>\'',
    '            + \'<div id="det"></div>\';',
    '          document.getElementById("more").addEventListener("click", function () {',
    '            this.setAttribute("aria-expanded", "true");',
    '            document.getElementById("det").textContent = "A provisional residence permit (MVV) is needed.";',
    '          });',
    '        });',
    '      });',
    '    });',
    '  });',
    '});',
  ].join("\n");
  return `<!doctype html><html lang="en"><head><title>IND form</title></head><body>
<nav aria-label="Main"><button type="button" aria-expanded="false" aria-controls="menu">Open menu</button>
  <div id="menu" hidden>Residency Citizenship News</div></nav>
<p>Lede: what this permit is for.</p>
<label for="nat">What is your nationality?</label>
<input id="nat" type="text" role="combobox" aria-owns="sugg" autocomplete="off">
<ul id="sugg" class="ui-autocomplete" hidden></ul>
<fieldset id="q2"><legend>Do you already have a valid Dutch residence permit?</legend>
  <label><input type="radio" name="v" value="yes"> Yes</label>
  <label><input type="radio" name="v" value="no"> No</label>
</fieldset>
<div id="q3holder"></div>
<div id="submitholder"></div>
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
</body></html>
<script>${script}</script>`;
}

describe.skipIf(Boolean(noChrome) && !CI)("s34 — the recipe drives the IND's form as a browser showed it", () => {
  it("walks all five steps and reads a list that exists only at the end of them", async () => {
    served = indFormFixture();
    const reader = openBrowserReader();
    try {
      const walk = entry({
        slice: { from: "Requirements", to: "Cookies Proclaimer" },
        steps: [
          { step: "select", field: "What is your nationality?", option: "Turkish" },
          { step: "answer", question: "Do you already have a valid Dutch residence permit?", answer: "no" },
          { step: "answer", question: "Did you have a Dutch residence permit and did it expire less than 2 years ago?", answer: "no" },
          { step: "press", button: "View information" },
          { step: "expand" },
        ],
      });
      const { reports, nextState } = await runWatch(
        { entries: [walk] }, emptyState, refuse, "2026-09-23", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      const text = nextState.entries["fixture-route"]!.text!;
      expect(text).toContain("You meet the general requirements that apply to everyone.");
      // Behind the disclosure, which is the whole reason `expand` is in the recipe.
      expect(text).toContain("A provisional residence permit (MVV) is needed.");
      // And NOT the navigation, which the narrowed `expand` leaves shut: it is
      // page furniture, and opening it would put the site's menu inside a
      // snapshot that a quote is checked against.
      expect(text, "the navigation menu was opened").not.toContain("Residency Citizenship News");
    } finally { await reader.close(); served = fixture(); }
  });
});

/**
 * Somewhere else entirely, on an origin of its own.
 *
 * A second server, because the thing being tested is the line between one site
 * and another and a path cannot stand in for it.
 */
// It answers 200, deliberately. A page that greets the reader with an error
// is caught by the status gate on the way out; a page that greets it happily
// is caught by nothing but the origin, which is the guard under test.
const elsewhereBody = "<h1>Somewhere else</h1><p>Requirements Cookies Proclaimer</p>";
const elsewhere: Server = createServer((req, res) => {
  metElsewhere.push(introduction(req));
  // An ordinary CORS endpoint: it allows the origin, and nothing else. That
  // is the shape a preflight announcing an unexpected header fails against.
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*" });
    res.end();
    return;
  }
  if ((req.url ?? "").startsWith("/api")) {
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain; charset=utf-8" });
    res.end("the cross-origin answer");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(elsewhereBody);
});
await new Promise<void>((resolve) => { elsewhere.listen(0, "127.0.0.1", () => resolve()); });
const elsewhereOrigin = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
afterAll(() => { elsewhere.close(); });

describe.skipIf(Boolean(noChrome) && !CI)("s34 — a step may not take the reader to another site", () => {
  it("refuses the reading when a pressed control navigates away, and says where it went", async () => {
    // The worst failure this reader has, and it was open until 2026-09-24: a
    // source page that has been repointed makes the watch hash a third
    // party's bytes as the authority's, check the quotes against them, and
    // write them into a flag and an issue under the authority's name. The
    // page below is the measurement the reviewer made, served as a fixture.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<button type="button" id="go">View information</button>
<footer>Cookies Proclaimer</footer>
<script>document.getElementById("go").addEventListener("click", function () {
  location.href = ${JSON.stringify(`${elsewhereOrigin}/x`)};
});</script>
</body></html>`;
    const reader = openBrowserReader();
    try {
      const walked = entry({ slice: undefined, steps: [{ step: "press", button: "View information" }] });
      const { reports, nextState } = await runWatch(
        { entries: [walked] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error, "the error does not say the browser was moved").toMatch(/navigated|away/i);
      expect(reports[0]!.error, "the error does not say where it ended up").toContain(elsewhereOrigin);
      expect(nextState.entries["fixture-route"], "somebody else's page was recorded").toBeUndefined();
    } finally { await reader.close(); served = fixture(); }
  });

  it("refuses a page that redirects to another site before a step ever runs", async () => {
    // The baseline is the origin the WATCHLIST named, not wherever the load
    // ended. Reading it off the loaded page hands the decision to whoever the
    // page redirects to: the far 200 satisfies the status gate, the far
    // origin becomes the baseline, and the check after the steps compares it
    // with itself (Security review, round 2).
    redirectTo = `${elsewhereOrigin}/x`;
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry({ slice: undefined, steps: [] })] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error, "the error does not name where it went").toContain(elsewhereOrigin);
      expect(nextState.entries["fixture-route"], "somebody else's page was recorded").toBeUndefined();
    } finally { await reader.close(); redirectTo = undefined; served = fixture(); }
  });

  it("refuses a page that meta-refreshes to another site", async () => {
    // The same escape by the other door: no status code moves, the document
    // replaces itself.
    served = `<!doctype html><html><head>
<meta http-equiv="refresh" content="0; url=${elsewhereOrigin}/x">
</head><body><p>Lede: what this permit is for.</p><footer>Cookies Proclaimer</footer></body></html>`;
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch(
        { entries: [entry({ slice: undefined, steps: [] })] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error).toContain(elsewhereOrigin);
    } finally { await reader.close(); served = fixture(); }
  });

  it("still reads a source that redirects around its own site and comes back", async () => {
    // The Opportunity Card's notice, in miniature: the entry address answers
    // a redirect to a cookie check, which answers a redirect back to the
    // page. It ends where it started, which is the whole of what is asked —
    // and this is the case that proves the line is drawn at the origin and
    // not at the address.
    bounceOnce = true;
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text).toContain("Lede:");
    } finally { await reader.close(); bounceOnce = false; served = fixture(); }
  });

  it("reads a page whose own step moves it within the site, and says where it read", async () => {
    // The decision, declared: the ORIGIN is the trust line. A form that posts
    // back to a sub-path must not redden the morning, so a same-origin move
    // is read — but the address it was read at travels back with the reading
    // so a curator can see it without opening a browser.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<button type="button" id="go">View information</button>
<footer>Cookies Proclaimer</footer>
<script>document.getElementById("go").addEventListener("click", function () { location.href = "/elsewhere-here"; });</script>
</body></html>`;
    const reader = openBrowserReader();
    try {
      const walked = entry({ slice: undefined, steps: [{ step: "press", button: "View information" }] });
      const { reports } = await runWatch(
        { entries: [walked] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      const read = await openBrowserReader();
      try {
        const answer = await read.read(walked, "same-origin");
        expect(answer.ok).toBe(true);
        expect(answer.ok && answer.from, "the reading does not say where it was taken")
          .toContain("/elsewhere-here");
      } finally { await read.close(); }
    } finally { await reader.close(); served = fixture(); }
  });

  it("does not press a link, however much it looks like a disclosure", async () => {
    // `expand` is the one step that presses things without being told a name,
    // so it is the one that must not be able to travel.
    // Both disclosures render their text only when opened, so "was it opened"
    // is a question the reading can actually answer: a `<details>` whose
    // words are already in the markup would look the same either way.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<main>
  <a href="${elsewhereOrigin}/x" aria-expanded="false" aria-controls="blk">Show details</a>
  <div id="blk">A provisional residence permit (MVV) is needed.</div>
  <details id="rules"><summary>Show details</summary><span></span></details>
</main>
<footer>
  <details id="chrome"><summary>About this website</summary><span></span></details>
  Cookies Proclaimer
</footer>
<script>
document.getElementById("rules").addEventListener("toggle", function () {
  this.querySelector("span").textContent = "An extra requirement for researchers.";
});
document.getElementById("chrome").addEventListener("toggle", function () {
  this.querySelector("span").textContent = "A cookie notice nobody quoted.";
});
</script>
</body></html>`;
    const reader = openBrowserReader();
    try {
      const walked = entry({
        slice: { from: "Lede:", to: "Cookies Proclaimer" },
        steps: [{ step: "expand" }],
      });
      const { reports, nextState } = await runWatch(
        { entries: [walked] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      // The step does nothing to the link, so the page is read where it is.
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      const text = nextState.entries["fixture-route"]!.text!;
      expect(text).toContain("A provisional residence permit (MVV) is needed.");
      expect(text, "the other origin's body was read").not.toContain("Somewhere else");
      // A disclosure in the page's own content opens; one in the footer does
      // not. The details sweep ignored the furniture rule until round 3, so a
      // cookie notice opened into the slice and the next morning was a change
      // nobody made.
      expect(text, "a disclosure in the content stayed shut").toContain("An extra requirement for researchers.");
      expect(text, "a disclosure in the footer was opened into the reading")
        .not.toContain("A cookie notice nobody quoted.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("still reads a page whose own form posts back to the same address", async () => {
    // The check is about leaving the site, not about moving within it: the
    // IND's form submits to the URL it is already on, and a check that
    // refused that would refuse all five entries.
    served = fixture();
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch(
        { entries: [entry()] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
    } finally { await reader.close(); }
  });
});

/**
 * A page whose words arrive on a request of its own, with or without a frame
 * beside them.
 */
function slowFixture({ iframe = false } = {}): string {
  return `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
${iframe ? '<iframe src="/frame" width="1" height="1" title="An embed"></iframe>' : ""}
<div id="result"></div>
<footer>Cookies Proclaimer</footer>
<script>
fetch("/slow-content").then(function (r) { return r.text(); }).then(function (t) {
  document.getElementById("result").textContent = t;
});
</script>
</body></html>`;
}

describe.skipIf(Boolean(noChrome) && !CI)("s34 — an iframe in a source page is not the page", () => {
  const waiting = (): WatchEntry => entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] });

  it("waits for the page's own content when the page carries a subframe", async () => {
    // Subframes share the flat session, so their documents arrive looking
    // exactly like the page's. Until this was scoped to the main frame on
    // 2026-09-24, an iframe set the status the page was judged by AND
    // cleared the in-flight count, which is the wait: measured, the same page
    // read in 10.3 s with its content without the frame and in 3.7 s WITHOUT
    // its content with one — `ok: true`, the shell, hashed as the authority's
    // reading and `unchanged` every morning after. A consent widget is enough
    // to do that, and a consent widget is not the authority.
    served = slowFixture({ iframe: true });
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [waiting()] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text, "the shell was read instead of the page")
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); served = fixture(); }
  });

  it("reads the page even when the subframe's own document is a 404", async () => {
    // A subframe's status is not the page's. Judging the page by whichever
    // Document arrived last would fail a page that is perfectly fine because
    // something embedded in it is not.
    served = slowFixture({ iframe: true });
    frameStatus = 404;
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [waiting()] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("You meet the general requirements that apply to everyone.");
    } finally { await reader.close(); frameStatus = 200; served = fixture(); }
  });
});

describe.skipIf(Boolean(noChrome) && !CI)("s34 — the watch names itself to the source and to nobody else", () => {
  it("tells the source who is asking, and tells a host it merely embeds nothing", async () => {
    // `Network.setExtraHTTPHeaders` and `setUserAgentOverride` are per-SESSION,
    // so until 2026-09-24 every host a source page embedded was handed
    // `x-source-contact` and the watch's name in the User-Agent — measured on
    // a cross-origin iframe. The fetcher only ever names itself to the source
    // it was pointed at, and this is what makes the browser tier keep the
    // same promise.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<iframe src="${elsewhereOrigin}/embed" width="1" height="1" title="An embed"></iframe>
<footer>Cookies Proclaimer</footer>
</body></html>`;
    metElsewhere.length = 0;
    metAtSource.length = 0;
    const reader = openBrowserReader();
    try {
      const { reports } = await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");

      // Every request the PAGE makes to its own origin — document, image,
      // favicon, the lot. Not every request Chrome can make on a page's
      // behalf: a service worker fetches from a context this reader does not
      // intercept, and a source that registers one routes its later requests
      // through it unnamed. That gap is declared in CONTEXT.md's Browser tier
      // entry and in the scenario's correction paragraph rather than being
      // asserted away here (Security review, 2026-09-24).
      expect(metAtSource.length, "the source was never asked for anything").toBeGreaterThan(0);
      expect(metAtSource.every((met) => met.named), "the source was not told who is asking").toBe(true);
      expect(metAtSource.every((met) => met.contact === "https://github.com/OytunOnal/permit-rulebook-data"),
        "the source was not given an address for the operator").toBe(true);
      expect(metAtSource.some((met) => met.acrh !== undefined),
        "the source was preflighted, so its own requests are not what a visitor sends").toBe(false);

      expect(metElsewhere.length, "the embedded host was never asked for anything").toBeGreaterThan(0);
      expect(metElsewhere.some((met) => met.named), "a host the page embeds was told the watch's name").toBe(false);
      expect(metElsewhere.some((met) => met.contact !== undefined),
        "a host the page embeds was given the operator's address").toBe(false);
    } finally { await reader.close(); served = fixture(); }
  });

  it("leaves a page's cross-origin call exactly as a visitor's browser would send it", async () => {
    // The header was set on the whole tab until 2026-09-24, which made every
    // cross-origin request NON-SIMPLE: Chrome preflighted it, announcing
    // `x-source-contact` by name, and against an ordinary CORS endpoint that
    // allows the origin and nothing else the preflight is refused and the
    // page's own call FAILS. A page whose content arrives that way renders
    // short for this watch and for nobody else — the wrong-reading class.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<div id="out"></div>
<footer>Cookies Proclaimer</footer>
<script>
fetch("${elsewhereOrigin}/api").then(function (r) { return r.text(); })
  .then(function (t) { document.getElementById("out").textContent = t; })
  .catch(function (e) { document.getElementById("out").textContent = "FAILED: " + e.message; });
</script>
</body></html>`;
    metElsewhere.length = 0;
    const reader = openBrowserReader();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      const text = nextState.entries["fixture-route"]!.text!;
      // The page's own call succeeded, so its answer is in the reading.
      expect(text, "the page's cross-origin call failed under the watch").toContain("the cross-origin answer");
      expect(text).not.toContain("FAILED:");
      // And nothing was preflighted, because nothing unusual was sent.
      expect(metElsewhere.some((met) => met.method === "OPTIONS"),
        "the watch made the page preflight a request a visitor would not").toBe(false);
      expect(metElsewhere.some((met) => met.acrh !== undefined),
        "a third party was told this header exists by name").toBe(false);
      expect(metElsewhere.some((met) => met.contact !== undefined),
        "a third party was given the operator's address").toBe(false);
      expect(metElsewhere.some((met) => met.named), "a third party was told the watch's name").toBe(false);
    } finally { await reader.close(); served = fixture(); }
  });

  it("reads a page that embeds a genuinely cross-site frame", async () => {
    // An out-of-process iframe's document request is STARTED in the page's
    // session and finished in the frame's own target, so the count of what is
    // in flight never came back to zero and the page was never finished —
    // measured, `did not finish this page within 45s` on a page whose only
    // sin was embedding somebody. `localhost` against `127.0.0.1` is a
    // different site, which is what puts the frame in its own process; two
    // ports on one host would not.
    const crossSite = elsewhereOrigin.replace("127.0.0.1", "localhost");
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<iframe src="${crossSite}/embed" width="1" height="1" title="An embed"></iframe>
<div id="out"></div>
<footer>Cookies Proclaimer</footer>
<script>setTimeout(function () {
  document.getElementById("out").textContent = "the page's own late content";
}, 2500);</script>
</body></html>`;
    const reader = openBrowserReader({ budgetMs: 20_000 });
    const started = Date.now();
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(Date.now() - started, "the frame held the read past its budget").toBeLessThan(20_000);
      // And it still waited for the page's own content, which is the thing
      // the count is there to wait for.
      expect(nextState.entries["fixture-route"]!.text)
        .toContain("the page's own late content");
    } finally { await reader.close(); served = fixture(); }
  });

  it("reads a page whose requests are cancelled under it", async () => {
    // A request that is already gone when the driver continues it answers
    // with an error, which is swallowed — nothing is waiting on a request
    // nobody will receive. This is the case that says the swallow is a
    // decision and not a hope: a page that cancels its own requests reads.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<div id="out">the page's own content</div>
<footer>Cookies Proclaimer</footer>
<script>
for (var i = 0; i < 12; i++) {
  var stop = new AbortController();
  fetch("/never", { signal: stop.signal }).catch(function () {});
  stop.abort();
}
</script>
</body></html>`;
    const reader = openBrowserReader({ budgetMs: 15_000 });
    try {
      const { reports, nextState } = await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome, reports[0]!.error).toBe("baseline");
      expect(nextState.entries["fixture-route"]!.text).toContain("the page's own content");
    } finally { await reader.close(); served = fixture(); }
  });

  it("will not open an address carrying a name and password, and asks for nothing", async () => {
    // The fetcher refused these from round 5; the browser did not, and a
    // browser sends credentials the moment it navigates and keeps sending
    // them. Measured 2026-09-24: `ok: true`, the host saw `Authorization:
    // Basic …` on the page AND on the favicon, and the page behind the
    // password was hashed and ready to be committed as the authority's.
    metAtSource.length = 0;
    const before = metAtSource.length;
    const reader = openBrowserReader();
    try {
      const credentialled = entry({ url: origin.replace("//", "//watcher:hunter2@") });
      const { reports, nextState } = await runWatch(
        { entries: [credentialled] }, emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(reports[0]!.outcome).toBe("unreachable");
      expect(reports[0]!.error, "the password was printed").not.toContain("hunter2");
      expect(reports[0]!.error, "the name was printed").not.toContain("watcher");
      expect(nextState.entries["fixture-route"], "a page behind a password was recorded").toBeUndefined();
      // Nothing was asked for at all: the refusal comes before the browser
      // opens anything, so there is no request to carry the credentials.
      expect(metAtSource.length - before, "the source was contacted anyway").toBe(0);
    } finally { await reader.close(); }
  });

  it("bounds the address it reports back, on the branch that does not check the origin", async () => {
    // The `anywhere` branch of the browser's origin check returns an address
    // straight from the page, and a page can make one as long as it likes.
    // No browser entry takes that branch today, which is exactly how a bound
    // goes missing — so it is pinned here, at the call site, rather than by
    // asking the helper it calls (Standards review, 2026-09-25).
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<footer>Cookies Proclaimer</footer>
<script>history.pushState({}, "", "/" + "a".repeat(9000));</script>
</body></html>`;
    const reader = openBrowserReader();
    try {
      const answer = await reader.read(entry({ steps: [], slice: undefined }), "anywhere");
      expect(answer.ok, answer.ok ? "" : answer.error).toBe(true);
      if (!answer.ok) return;
      expect(answer.from!.length, "the address the page chose was reported whole")
        .toBeLessThanOrEqual(MOST_OF_AN_ADDRESS + `… (${answer.from!.length} characters)`.length + 16);
      expect(answer.from, "the reading does not say it was shortened").toContain("characters)");
    } finally { await reader.close(); served = fixture(); }
  });

  it("does not carry one page's interception counts onto the next page's line", async () => {
    // `paused` and `pausedMs` are logged beside an entry's id, so they have
    // to be that entry's. A refused read used to leave the previous page's
    // numbers standing (Standards review, 2026-09-25).
    const reader = openBrowserReader();
    try {
      served = fixture();
      const good = await reader.read(entry({ steps: [], slice: undefined }), "same-origin");
      expect(good.ok).toBe(true);
      expect(reader.lastCost().paused, "the first read paused nothing at all").toBeGreaterThan(0);

      // A read that is refused before anything opens.
      const refused = await reader.read(
        entry({ url: origin.replace("//", "//watcher:hunter2@"), steps: [] }), "same-origin",
      );
      expect(refused.ok).toBe(false);
      expect(reader.lastCost(), "the refused read reported the previous page's cost")
        .toEqual({ paused: 0, pausedMs: 0 });
    } finally { await reader.close(); served = fixture(); }
  });

  it("does not let a subresource that never answers outlast the read's budget", async () => {
    // Every paused request is continued, including on the failure path. This
    // is the backstop under that: a request nothing ever answers costs the
    // entry its budget and not the run.
    served = `<!doctype html><html><body>
<p>Lede: what this permit is for.</p>
<img src="/never" alt="">
<footer>Cookies Proclaimer</footer>
</body></html>`;
    const reader = openBrowserReader({ budgetMs: 8_000 });
    const started = Date.now();
    try {
      await runWatch(
        { entries: [entry({ slice: { from: "Lede:", to: "Cookies Proclaimer" }, steps: [] })] },
        emptyState, refuse, "2026-09-24", reader.read,
      );
      expect(Date.now() - started, "the read outlasted its own budget").toBeLessThan(14_000);
    } finally { await reader.close(); served = fixture(); }
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
