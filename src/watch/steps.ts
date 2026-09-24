import type { WatchStep } from "./core.js";
import { MOST_OF_A_PAGE_WORD, printableWithin, PRINTABLE_WITHIN_SOURCE } from "./failure.js";

/**
 * The step vocabulary: how a field is driven whatever the page built it out
 * of, and what a failure says so that a run nobody can attach to still
 * diagnoses itself. The page-side half is at the bottom, as a string, because
 * it runs in Chrome and not here. See `browser.ts` for the map.
 */

export type InPage = (step: unknown, phase?: string) => Promise<unknown>;

/** What a page-side phase hands back. */
export interface Phase {
  error?: string;
  kind?: "select" | "combo" | "text";
  shape?: string;
  picked?: boolean;
  offers?: string[];
  /** What the field held when it was asked — empty means the typing never landed. */
  value?: string;
  /** What the control said about being open, if it says anything. */
  expanded?: string | null;
}

/** How long to let a typeahead answer before calling its silence an answer. */
const SUGGEST_MS = 3_000;

/** The same, for the probes that only diagnose — the attempts before them have
 * already shown how long this control takes to answer, and the whole diagnosis
 * has to fit inside what is left of the entry's budget. */
const PROBE_MS = 1_200;

/**
 * Choose an option in a field, whatever the page built the field out of.
 *
 * A native select and an ARIA combobox the page can drive on its own. A text
 * box it cannot: the options do not exist until something is typed, and
 * "typed" has to mean real key events: one `keyDown`/`keyUp` per character
 * from Chrome itself, into the focused control, which is what a person sends.
 *
 * Not because ind.nl demanded it. The run that seemed to say so — 2026-09-23,
 * dispatch 35908751925, "offered nothing at all", five pages out of five —
 * turned out to be a different bug entirely: the reader was looking in the
 * wrong menu, and the suggestions had been arriving the whole time. The
 * honest reason is the narrower one the fixtures hold: a control that listens
 * for keys and ignores a value written into it cannot be driven any other way
 * (`keysOnly` proves it), and typing is what the vocabulary's word for this
 * step means. The setter stays as a second attempt for the opposite control.
 *
 * The page-side setter stays as the fallback. It is not dead code: the
 * typeahead fixture is driven by it in the case that proves a page CAN be
 * driven that way, and a control that ignores synthetic keys but honours the
 * setter is a shape this has already met once.
 */
export async function selectInto(
  step: WatchStep & { step: "select" },
  inPage: InPage,
  type: (text: string) => Promise<void>,
  deadline: number,
  askedSince: (since: number) => string[],
): Promise<string | null> {
  const shape = await inPage(step, "shape") as Phase;
  if (shape.error) return shape.error;
  // Anything but a text box, the page drives itself.
  if (shape.kind !== "text") return await inPage(step) as string | null;

  const typeAndPick = async (text: string, keys: boolean): Promise<Phase> => {
    await inPage(step, "clear");
    if (keys) await type(text);
    else await inPage({ ...step, text }, "type-fallback");
    return await waitForOption(step, inPage);
  };

  // Real keys first, the page's own setter second — a control may honour
  // either, and only one of them is what a person does.
  const typingStarted = Date.now();
  let attempt = await typeAndPick(step.option, true);
  if (attempt.picked) return null;
  const afterKeys = attempt.offers ?? [];
  const keyValue = attempt.value ?? "";
  const keyExpanded = attempt.expanded;
  attempt = await typeAndPick(step.option, false);
  if (attempt.picked) return null;
  const afterSetter = attempt.offers ?? [];
  const setterValue = attempt.value ?? "";

  /**
   * One thing the page wrote, quoted into a sentence of ours.
   *
   * The sentence below is OURS and runs long on purpose — but an option's
   * label, a field's value and a control's role are the PAGE's, and a
   * quotation belongs to whoever wrote it (`failure.ts`'s opening). So each
   * one is bounded and made printable here, where it is quoted, rather than
   * riding the diagnosis's length exemption into the log line and the issue
   * (Security review, 2026-09-24).
   *
   * `JSON.stringify` stays around the outside: it is what puts the quotation
   * marks on, and what stops a page's own quote mark ending ours.
   */
  const quoted = (said: string) => JSON.stringify(printableWithin(said, MOST_OF_A_PAGE_WORD));

  /** At most eight of anything: a page chooses how many options it has, and a
   * watch does not get to put all of them in an error that becomes a flag and
   * an issue. Measured 2026-09-24: 5,000 options made a 441,449-character
   * message. */
  const list = (offers: string[]) => offers.length
    ? offers.slice(0, 8).map(quoted).join(", ")
      + (offers.length > 8 ? `, ... (${offers.length} in all)` : "")
    : "nothing";

  /**
   * Why it failed, in one line, without spending another run to find out.
   *
   * Two things hide behind "offered nothing": a control that wants more
   * characters before it will answer, and a list that answers but spells the
   * option differently — Turkey for Türkiye. One probe cannot tell them apart
   * and three can, so the field is asked what it offers after one character,
   * after three, and after the whole word. Bounded by the entry's own budget:
   * a diagnosis that never arrives because the read timed out is no diagnosis.
   */
  const probes: string[] = [];
  for (const length of [1, 3, step.option.length]) {
    if (Date.now() > deadline - (PROBE_MS + 2_000)) { probes.push("(no budget left to probe further)"); break; }
    const prefix = step.option.slice(0, length);
    await inPage(step, "clear");
    await type(prefix);
    const reading = await waitForOption(step, inPage, PROBE_MS);
    probes.push(`"${prefix}" (the field then held ${quoted(reading.value ?? "")}) -> `
      + `${reading.offers?.length ? list(reading.offers) : "nothing"}`);
  }

  /**
   * What the page asked the network for while all of that was happening.
   *
   * A widget that shows nothing has either never asked or been refused, and
   * every message before this one left those two indistinguishable — which is
   * what five runs and a fifth render could not settle. A suggestion endpoint
   * answering 403 to this client is a wall against the client; no request at
   * all is a widget that never ran.
   */
  const asked = askedSince(typingStarted);
  return `step select: the option "${step.option}" is not in the field "${step.field}". `
    + `The field is ${shape.shape}. Real key events left it holding ${quoted(keyValue)} `
    + `(aria-expanded ${keyExpanded == null ? "unset" : quoted(keyExpanded)}) and offered ${list(afterKeys)}; `
    + `the value setter left it holding ${quoted(setterValue)} and offered ${list(afterSetter)}. `
    + `By prefix: ${probes.join("; ")}. `
    + `The page asked for: ${asked.length ? asked.join(" | ") : "nothing at all after the typing"}.`;
}

/** Poll the field until the wanted option is there to click, or time is up. */
async function waitForOption(step: unknown, inPage: InPage, patience = SUGGEST_MS): Promise<Phase> {
  const until = Date.now() + patience;
  let last: Phase = { offers: [] };
  for (;;) {
    const picked = await inPage(step, "pick") as Phase;
    if (picked.picked) return picked;
    last = await inPage(step, "offers") as Phase;
    if (Date.now() >= until) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
}

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
export const PERFORM_STEP = `function (step, phase) {
  // The watch's one rule about what may be printed, spliced in from its owner
  // in failure.ts because this half runs in Chrome and cannot import it.
  // Every fragment below that the PAGE wrote goes through it before it lands
  // in a message: an option's label, a control's tag, type and role, the text
  // beside a label. The message around them is ours; they are not.
  ${PRINTABLE_WITHIN_SOURCE}
  var MOST_OF_A_PAGE_WORD = ${MOST_OF_A_PAGE_WORD};
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
  /** What a set of elements IS, for a message that has to diagnose from afar.
   *
   * A tag name, a type and a role are all the page's own words — a role is an
   * attribute, and an attribute is whatever the author put in it. Measured
   * 2026-09-24: one role attribute carried ten thousand characters, a newline
   * and a right-to-left override into the middle of the step diagnosis. */
  function shapes(list) {
    var all = [].slice.call(list);
    return all.slice(0, MOST).map(function (e) {
      var role = word(e.getAttribute("role"));
      var type = word(e.type);
      return word(e.tagName) + (type ? "[type=" + type + "]" : "") + (role ? "[role=" + role + "]" : "");
    }).join(", ") + (all.length > MOST ? ", ... (" + all.length + " in all)" : "");
  }
  /** One thing the page wrote, as much of it as a message may carry. */
  function word(said) { return printableWithin(said, MOST_OF_A_PAGE_WORD); }
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
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  /** The first few things on offer, so a wrong option says what the right ones are. */
  function offered(list) {
    var words = list.map(function (o) { return JSON.stringify(word(o.textContent || o.value || "")); });
    return words.length ? words.slice(0, 6).join(", ") + (words.length > 6 ? ", ..." : "") : "nothing";
  }
  /** At most this many of anything in a message a person has to read. A page
   * chooses how many options and how many controls it has; a watch does not
   * get to put all of them in an error, a flag and an issue. */
  var MOST = 8;
  /** And this much of the page's own prose where a whole sentence of it is
   * the diagnosis: a label that is not where it was is found by reading what
   * IS there, and what is there is a SENTENCE, not a word.
   *
   * Four times a word is 160, and 160 is measured rather than chosen: over
   * the 1,025 sentences of the seven browser entries' own stored text
   * (watch/state.json, read 2026-09-24), the median sentence is 67
   * characters and 93.1% of them are within 160 — where a word's own bound,
   * 40, holds 21.3%. A sentence past it says its own length instead, which
   * is the next fact a curator needs about it.
   *
   * No backtick in this comment: it is inside the page script's template
   * literal, and one would end it. */
  var MOST_OF_NEARBY_TEXT = 4 * MOST_OF_A_PAGE_WORD;
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
    var found = [].slice.call(scope.querySelectorAll("select,input,button,textarea,[role]")).slice(0, 8);
    return " — near that label the page has: " + (found.length ? shapes(found) : "no control at all")
      + "; the text there reads " + JSON.stringify(printableWithin(norm(scope.textContent), MOST_OF_NEARBY_TEXT));
  }
  /**
   * Wherever a control keeps its options, once it has any.
   *
   * The list is found by what the control SAYS owns it before anything is
   * guessed from structure: a typeahead built on jQuery UI — which is what
   * ind.nl builds, and the widget class on its own search box says so —
   * appends its menu to the end of the body, nowhere near the input, and
   * points at it with aria-owns.
   */
  function listOf(el) {
    var listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
    // Every candidate, in order of how sure we are — and ALL of the ones a
    // selector can match, not the first.
    //
    // A page has more than one of these. ind.nl carries two jQuery UI menus:
    // the site search box's, which is empty and shut, and the nationality
    // field's, which is the one with the answers in it. Asking for the first
    // match got the search box's, found it shut, and reported that the field
    // had offered nothing — through five runs and a fifth render, while the
    // suggestions were sitting in the second one (2026-09-23).
    var candidates = [];
    if (listId) candidates.push(document.getElementById(listId));
    if (el.getAttribute("role") === "listbox") candidates.push(el);
    if (el.parentNode) push(candidates, el.parentNode.querySelectorAll("[role=listbox]"));
    push(candidates, (el.closest("div, fieldset, form") || document).querySelectorAll("[role=listbox]"));
    push(candidates, document.querySelectorAll(
      "ul[class*=autocomplete], ul[class*=suggest], ul[class*=typeahead], ul[role=listbox], ul[class*=ui-menu]"));
    var open = candidates.filter(function (found) {
      return found && !found.hidden && (found.offsetParent !== null || found === el);
    });
    // Among the open ones, the one with something in it: a widget leaves its
    // empty menu in the document, and an empty list is not an answer.
    for (var i = 0; i < open.length; i++)
      if (open[i].querySelector("[role=option], li, a")) return open[i];
    return open.length ? open[0] : null;
  }
  function push(into, nodes) { [].slice.call(nodes).forEach(function (n) { into.push(n); }); }
  /**
   * The things in that list a person could pick.
   *
   * An option is whatever the page made one out of: a role=option, a list
   * item, or a link — ind.nl renders its nationalities as links, measured in a
   * real browser on 2026-09-23. Only the innermost is kept, so a list item
   * wrapping a link offers the link once rather than the pair twice, and the
   * thing clicked is the thing that carries the handler.
   */
  function optionsOf(el) {
    var list = listOf(el);
    if (!list) return [];
    var all = [].slice.call(list.querySelectorAll("[role=option], li, a"))
      .filter(function (o) {
        return String(o.textContent || "").trim() && (o.offsetParent !== null || list === el);
      });
    return all.filter(function (o) {
      return !all.some(function (other) { return other !== o && o.contains(other); });
    });
  }
  /** The one selector that finds a field however the page chose to build it. */
  var FIELD = "select, [role=combobox], [role=listbox], [aria-haspopup=listbox], input[type=text], input:not([type])";

  // ---- phases -------------------------------------------------------------
  // The typing phases are driven from Node, because only Node can send a real
  // key event. Everything else the page can do for itself.

  if (phase === "shape") {
    var control = named(FIELD, step.field, "the field");
    if (control.error) return { error: "step select: " + control.error + near(step.field) };
    var kind = control.el.tagName === "SELECT" ? "select"
      : (control.el.tagName === "INPUT" ? "text" : "combo");
    if (kind === "text") {
      control.el.focus();
      control.el.click();
    }
    return { kind: kind, shape: shapes([control.el]) };
  }

  if (phase === "clear") {
    var box = named(FIELD, step.field, "the field");
    if (box.error) return { error: box.error };
    setNative(box.el, "");
    fire(box.el, "input");
    box.el.focus();
    return { ok: true };
  }

  if (phase === "offers") {
    var reading = named(FIELD, step.field, "the field");
    if (reading.error) return { error: reading.error };
    var list = optionsOf(reading.el);
    // These three are DATA rather than a message — Node decides what to say
    // about them — but they are the page's words and they travel over the
    // protocol to get there, so they are cut to what anything downstream can
    // use rather than shipped whole. Node quotes them through the same rule
    // when it builds the sentence, in selectInto.
    return {
      offers: list.map(function (o) { return word(o.textContent || ""); }),
      // What the field actually holds, and whether it says it opened. Between
      // them these separate the three ways typing fails: the keys never
      // landed (the box is still empty), the box filled and the control never
      // reacted (it wants something else), or it reacted and had no match
      // (the option is spelled differently, or needs more characters).
      value: word(reading.el.value),
      expanded: reading.el.getAttribute("aria-expanded") == null
        ? null : word(reading.el.getAttribute("aria-expanded"))
    };
  }

  if (phase === "pick") {
    var target = named(FIELD, step.field, "the field");
    if (target.error) return { error: target.error };
    var want = norm(step.option);
    var picks = optionsOf(target.el).filter(function (o) { return norm(o.textContent) === want; });
    if (picks.length !== 1) return { picked: false };
    picks[0].click();
    return { picked: true };
  }

  /**
   * Set an input's value the way a keystroke does, for the pages that need it.
   *
   * Assigning to .value is invisible to React and to anything else that wraps
   * the property with its own setter: the framework's state never changes, so
   * its listener never runs and no suggestion is ever requested. Calling the
   * prototype's own setter underneath it is what makes the following input
   * event carry the text. It is the fallback now — real key events are what a
   * person sends, and ind.nl wanted those — but the fixture proves a page can
   * be driven this way, so it stays.
   */
  function setNative(el, text) {
    var proto = Object.getPrototypeOf(el);
    var setter = Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, text);
    else el.value = text;
  }

  if (phase === "type-fallback") {
    var typed = named(FIELD, step.field, "the field");
    if (typed.error) return { error: typed.error };
    setNative(typed.el, step.text);
    fire(typed.el, "input");
    typed.el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: String(step.text).slice(-1) }));
    return { ok: true };
  }

  // ---- the steps a page can do without Node's help ------------------------

  if (step.step === "select") {
    // Reached only for a native select or an ARIA combobox; a text box is
    // driven from Node, which can type.
    var wantedOption = norm(step.option);
    var native = named("select", step.field, "the field");
    if (!native.error) {
      var options = [].slice.call(native.el.options).filter(function (o) { return norm(o.textContent) === wantedOption || norm(o.value) === wantedOption; });
      if (options.length !== 1) return 'step select: the option "' + step.option + '" is not in the field "' + step.field + '" (it offers: ' + offered([].slice.call(native.el.options)) + ")";
      native.el.value = options[0].value;
      fire(native.el, "input");
      fire(native.el, "change");
      return null;
    }
    var combo = named("[role=combobox], [role=listbox], [aria-haspopup=listbox]", step.field, "the field");
    if (combo.error) return "step select: " + combo.error + near(step.field);
    if (combo.el.getAttribute("aria-expanded") === "false") combo.el.click();
    var open = optionsOf(combo.el);
    var chosen = open.filter(function (o) { return norm(o.textContent) === wantedOption; });
    if (chosen.length !== 1)
      return 'step select: the option "' + step.option + '" is not in the field "' + step.field + '" ('
        + (open.length ? "it offers: " + offered(open) : "it offered nothing") + ")" + (open.length ? "" : near(step.field));
    chosen[0].click();
    return null;
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
    if (radios.length !== 1) return 'step answer: "' + step.question + '" has no single "' + step.answer + '" to choose' + near(step.question);
    // Click the LABEL, not the input.
    //
    // These two questions are native radios styled as a segmented pair, and
    // the input itself is not what a person hits: it is covered, or sized to
    // nothing, and a click on it did nothing visible in a real browser on
    // 2026-09-23 while a click on the label's box registered. Clicking the
    // label is also what a person does on any ordinary form, so it is the
    // right default and not a workaround. The input is the fallback for a
    // radio that has no label at all.
    //
    // Pressing rather than setting: a click does the lot natively — sets
    // checked, then fires click, input and change in the order a listener
    // expects. Setting the property and dispatching the events by hand got
    // that order wrong and left a framework's own handler unrun. No backtick
    // in this comment, or any other inside PERFORM_STEP: the page script is a
    // template literal, and one would end it here.
    var hit = radios[0].closest("label") || labelFor(radios[0]) || radios[0];
    hit.click();
    return null;
  }
  if (step.step === "press") {
    var button = named("button, input[type=submit], input[type=button], a[role=button], [role=button]", step.button, "the button");
    if (button.error) return "step press: " + button.error + near(step.button);
    button.el.click();
    return null;
  }
  if (step.step === "expand") {
    // Only a disclosure inside the page's own content: a <details>, or a
    // control that says both that it is closed and what it opens.
    //
    // Two narrowings, both learned rather than guessed. Clicking everything
    // that merely carries aria-expanded opened the site's navigation menu —
    // which is chrome, not a collapsed block of the text being read — so a
    // control must also name what it controls, and must not sit in the page's
    // furniture. The regions are named structurally, by what HTML calls them,
    // rather than by any word on this site: a rule keyed to a heading would
    // be a rule that stops working when the heading is rewritten.
    //
    // It still names nothing and so cannot fail: a page with nothing folded
    // away is simply already open, and this step is the difference between
    // reading a sentence a reader has to click for and not reading it.
    var FURNITURE = "nav, header, footer, aside, dialog, [role=navigation], [role=banner], [role=contentinfo], [role=dialog], [role=search]";
    // Both arms honour it. The details sweep did not until 2026-09-24, so a
    // <details> in a footer opened, its text landed inside the slice, and the
    // next morning was a change nobody made.
    [].slice.call(document.querySelectorAll("details"))
      .filter(function (d) { return !d.closest(FURNITURE); })
      .forEach(function (d) { d.open = true; });
    [].slice.call(document.querySelectorAll('[aria-expanded="false"][aria-controls]'))
      .filter(function (el) { return !el.closest(FURNITURE); })
      // And never a link. A disclosure that is a link is a link: pressing it
      // takes the tab somewhere, and this step presses everything it finds
      // without being told a name, so it is the one step that must not be
      // able to travel. Measured 2026-09-24: a cross-origin anchor wearing
      // aria-expanded took the reader to another site, which then came back
      // as the source's own text.
      .filter(function (el) { return el.tagName !== "A" && !el.closest("a[href]"); })
      .forEach(function (el) { el.click(); });
    return null;
  }
  return 'step "' + step.step + '" is not one this reader knows';
}`;

/** Re-exported so a caller building a watchlist entry has the vocabulary to
 * hand without reaching past this module for it. */
