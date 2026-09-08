import type { Criterion, Dataset } from "./types.js";

/**
 * What a piece of renderable text DECLARES itself to be. The gate reads this,
 * never a surface trace of it.
 *
 * The gate keyed on quotation marks until this review: `if (t.ours ||
 * !QUOTATION_MARK.test(t.text)) continue`. A check that reads a surface trace
 * is passed by editing the trace, and the agent learns to edit it without
 * meaning to — a rule enforced by a sentence in an error string ("Deleting the
 * quotation marks is not one of the options") is not enforced. It missed the
 * concrete case it was written for: "Recognised by the state where it was
 * acquired — German recognition not required (§ 6 BeschV)" cites a statute,
 * carries no source, contains no quotation mark, and passed.
 */
export type RenderableKind =
  /** The authority's position, in our words or its own. It must carry a
   * covering source, or a declared, dated reason there is none. */
  | "authority"
  /** Declared ours in the data — a route reading, or the prose beside a
   * declared absence. Being there IS the attribution. */
  | "ours"
  /** A name with no truth claim to source: a route name, an option label, a
   * threshold's row label, a statutory citation, a field's own wording. The
   * kind check has nothing to say about these, so the additive quotation-mark
   * check is the only one that reaches them — which is why it is kept. */
  | "label";

/**
 * Every sentence the dataset ships that can reach a screen, the kind it
 * declares itself to be, and what provenance — if any — sits beside it.
 *
 * The product's promise is that every value carries its official source, a
 * verbatim quote and the date it was read. Numbers kept that promise; sentences
 * did not, because `note` was typed as a bare string and provenance was
 * impossible there by construction. 39 of the 45 notes that shipped quoted an
 * authority; none carried a URL or a date, and the quote-fidelity gate could
 * not see one of them. Three times in two days a note turned out to be doing a
 * rule's job (s5e).
 *
 * The walk is deliberately written over the TEXT, not over the fields: moving a
 * sentence to another slot must not be a way to silence it.
 */
export interface RenderableText {
  /** Where it lives, in dataset coordinates. */
  path: string;
  text: string;
  /** What this slot declares the text to be. */
  kind: RenderableKind;
  /** The words of the authority this sentence quotes, where one is attached. */
  quote?: string;
  /** An `authority` text may stand without a quote only behind a declared,
   * dated reason there is none — the reason a card prints to the reader. */
  declared_absence?: boolean;
}

/**
 * The marks a reader takes to mean "these are somebody else's words". The
 * apostrophe is not one of them — French and Dutch prose is full of it.
 */
const QUOTATION_MARK = /["“”„‟«»‹›]/;

/** Balanced runs between those marks: what the reader is being told was said. */
const QUOTED_SPAN = /"([^"]+)"|“([^”]+)”|„([^“”]+)[“”]|«\s*([^»]+?)\s*»/g;

/** The same runs, marks included, so removing them leaves any lone mark behind. */
const SPAN_WITH_MARKS = /"[^"]+"|“[^”]+”|„[^“”]+[“”]|«\s*[^»]+?\s*»/g;

const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();

export function quotedSpans(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTED_SPAN)) out.push(flatten(m[1] ?? m[2] ?? m[3] ?? m[4] ?? ""));
  return out.filter(Boolean);
}

/**
 * A quotation mark left over once every balanced run is taken away — one a
 * reader cannot read back to anything. Exported because the page has to ask
 * the same question of the rendered card, and it was re-deriving `QUOTED_SPAN`
 * two lines below importing `quotedSpans` to do it (review 2026-09-07).
 */
export function hasUnbalancedQuotationMark(text: string): boolean {
  return QUOTATION_MARK.test(text.replace(SPAN_WITH_MARKS, " "));
}

/**
 * Why one sentence fails the gate — the wording a curator has to act on, so a
 * build failure never leaves "delete the quotation marks" as the obvious fix.
 */
export interface QuotationOffence extends RenderableText {
  reason: "no-source" | "quote-does-not-cover" | "unbalanced";
}

const HONEST_OPTIONS =
  "give it a source (source_url, quote, retrieved_at) whose quote covers what it says, " +
  "or move the sentence to the route's `readings`, which says in the data and on the card " +
  "that the words are ours. Deleting the quotation marks is not one of the options — the " +
  "gate reads the kind the slot declares, not the punctuation.";

export function offenceMessage(o: QuotationOffence): string {
  const why =
    o.reason === "no-source"
      ? o.kind === "authority"
        ? "states the authority's position but carries no source_url and no retrieved_at, and declares no dated reason it has none"
        : "quotes an authority but carries no source_url and no retrieved_at"
      : o.reason === "unbalanced"
        ? "carries a quotation mark that opens nothing a reader can read back"
        : "quotes words its own source does not contain — a neighbouring quote is not provenance";
  return `${why}: “${flatten(o.text).slice(0, 90)}” — ${HONEST_OPTIONS}`;
}

/**
 * The one walk over everything the dataset can put in front of a person. A slot
 * missing here is a slot the gate cannot see, so new prose belongs in this
 * function on the day it is added — which is what the test for it checks.
 */
export function renderableTexts(dataset: Dataset): RenderableText[] {
  const out: RenderableText[] = [];
  /** A name the dataset gives something — the default, because most strings a
   * card renders are names, and a slot that means more than that has to say
   * which kind it is at the call site. */
  const label = (path: string, text: string | undefined, extra: Partial<RenderableText> = {}) => {
    if (text) out.push({ path, text, kind: "label", ...extra });
  };
  /** The authority's position, in our words or its own. */
  const authority = (path: string, text: string | undefined, extra: Partial<RenderableText> = {}) => {
    if (text) out.push({ path, text, kind: "authority", ...extra });
  };
  /** Declared ours in the data. */
  const ours = (path: string, text: string | undefined) => {
    if (text) out.push({ path, text, kind: "ours" });
  };

  dataset.fields.forEach((f, i) => {
    const p = `/fields/${i}`;
    label(`${p}/label`, f.label);
    label(`${p}/short_label`, f.short_label);
    label(`${p}/subject`, f.subject);
    label(`${p}/learn/label`, f.learn?.label);
    (f.options ?? []).forEach((o, j) => {
      label(`${p}/options/${j}/label`, o.label);
      label(`${p}/options/${j}/short`, o.short);
      // What an answer means here is our wording of our own question, so it is
      // a label like the rest of the question's words — and the additive
      // quotation-mark check still reaches it (s6, human walk 2026-09-08).
      label(`${p}/options/${j}/means`, o.means);
    });
  });

  /**
   * A citation renders on the card beside the quote it identifies, so it is
   * text a person reads. It names an article or a page; where it puts words in
   * quotation marks it is quoting, and the quote beside it has to carry them —
   * the orientation year's citation quoted the page's own "Last update" line,
   * which no source quote covered (found by this gate, 2026-09-07).
   */
  const addBasis = (path: string, v: { legal_basis?: string; quote: string } | undefined) => {
    if (v) label(`${path}/legal_basis`, v.legal_basis, { quote: v.quote });
  };

  const walkCriteria = (criteria: Criterion[], base: string): void => {
    criteria.forEach((c, i) => {
      const p = `${base}/criteria/${i}`;
      // One rule throughout: a quote covers the thing it is attached to, and
      // nothing else. The threshold's quote sits beside an amount and covers
      // the amount's own label and citation, below. Lending a quote sideways
      // is how a claim gets provenance it never earned.
      const quote = c.source?.quote;
      label(`${p}/short_reason`, c.short_reason, { quote });
      addBasis(`${p}/source`, c.source);
      if (c.op === "gte") {
        // The label belongs to the amount and renders on its line, so the
        // amount's quote is the provenance beside it — the same rule as the
        // citation below. Provenance covers the value it is attached to and
        // nothing else; that is what stops a quote being lent to a sentence.
        label(`${p}/threshold_label`, c.threshold_label, { quote: c.threshold.quote });
        addBasis(`${p}/threshold`, c.threshold);
      }
      if (c.op === "points") { addBasis(`${p}/required`, c.required); addBasis(`${p}/table`, c.table); }
      if (c.op === "any") {
        label(`${p}/label`, c.label, { quote });
        c.paths.forEach((path, j) => {
          label(`${p}/paths/${j}/label`, path.label, { quote });
          walkCriteria(path.criteria, `${p}/paths/${j}`);
        });
      }
    });
  };

  for (const country of dataset.countries)
    for (const route of country.routes) {
      const p = `/countries/${country.code}/routes/${route.id}`;
      label(`${p}/name`, route.name);
      label(`${p}/summary`, route.summary);
      // A precondition states what the AUTHORITY requires of an applicant —
      // "the professional licence must already be in hand" is the authority's
      // position or it is nothing. It was walked as a `label` until s5f, which
      // is the one slot the s5e gate could not see: 37 sentences rendered
      // under "Also required — not checked here" with no quote, no date and
      // nothing watching them. Kinded here, the slot is only usable with the
      // authority's words beside it, and the honest homes for the rest are the
      // ones s5e built — `statements` for a quoted precondition, `readings`
      // for a requirement that is our own inference.
      (route.preconditions ?? []).forEach((t, i) => authority(`${p}/preconditions/${i}`, t, {}));
      (route.statements ?? []).forEach((s, i) => {
        // A statement IS the authority's position, by the glossary's own
        // definition of the term. It stands on a quote, or on the declared and
        // dated reason there is none, which the card prints to the reader.
        authority(`${p}/statements/${i}/text`, s.text, {
          quote: s.source?.quote, declared_absence: s.unsourced !== undefined,
        });
        // The prose beside an absent quote explains what was tried. It is not
        // a reading — it renders under a heading that says the official wording
        // was NOT found — and it carries no provenance of its own, so it sits
        // with the slots that declare no kind and the quotation-mark check is
        // the one that reaches it. Nobody smuggles a claim about the law into
        // the one field that describes a failure to find one.
        label(`${p}/statements/${i}/unsourced/note`, s.unsourced?.note);
        addBasis(`${p}/statements/${i}/source`, s.source);
      });
      // A reading is ours because of where it lives, and for no other reason.
      (route.readings ?? []).forEach((r, i) => ours(`${p}/readings/${i}/text`, r.text));
      // The scope statement's reason is the same kind of sentence in a
      // different slot: our own words about our own interview, printed at the
      // top of the route page. It is walked here so a claim about the law
      // cannot be smuggled into it under cover of the slot being new (s6).
      // Not optional-chained: `scope` is schema-required, and chaining it would
      // let a route with no scope statement pass the gate silently rather than
      // fail it (Standards review, 2026-09-07).
      ours(`${p}/scope/reason`, route.scope.reason);
      walkCriteria(route.criteria, p);
    }

  (dataset.notices ?? []).forEach((n, i) => {
    authority(`/notices/${i}/title`, n.title, { quote: n.source.quote });
    authority(`/notices/${i}/body`, n.body, { quote: n.source.quote });
    addBasis(`/notices/${i}/source`, n.source);
  });

  return out;
}

/**
 * Where the dataset's sentences stand, counted. Step 1 of the slice asked for
 * the number the notes moved to, "reported, not hidden" — so this is printed by
 * `npm run check` beside the coverage and quote-fidelity lines, and pinned by a
 * test. A count only a test sees is not reported to anybody.
 */
export interface ProseProvenance {
  /** Sentences an authority is shown to have said: a criterion's own source,
   * or a statement standing on a quote. */
  with_provenance: number;
  /** Ours, declared as ours and rendered as ours: a route reading. */
  ours: number;
  /** Statements standing on a declared, dated reason no quote could be found —
   * the one exception, and an attributable decision rather than a blank. */
  declared_unsourced: number;
}

export function proseProvenance(dataset: Dataset): ProseProvenance {
  let with_provenance = 0;
  let ours = 0;
  let declared_unsourced = 0;
  const walk = (criteria: Criterion[]): void => {
    for (const c of criteria) {
      if (c.source) with_provenance++;
      if (c.op === "any") for (const p of c.paths) walk(p.criteria);
    }
  };
  for (const country of dataset.countries)
    for (const route of country.routes) {
      walk(route.criteria);
      for (const s of route.statements ?? []) {
        if (s.source) with_provenance++;
        if (s.unsourced) declared_unsourced++;
      }
      ours += (route.readings ?? []).length;
      // The scope statement's reason is ours, declared and rendered as ours —
      // so it is counted where the other sentences of ours are counted. A
      // measurement that stops moving when the data moves stops being one.
      if (route.scope.reason) ours++;
    }
  return { with_provenance, ours, declared_unsourced };
}

/**
 * The gate, in two parts, and it is worth being exact about which does what.
 *
 * The FIRST part keys on the kind the slot declares. Text that declares itself
 * the authority's position must carry a source, or the declared and dated
 * reason it carries none — whether or not it contains a quotation mark. This is
 * the part that catches a sentence like "German recognition not required (§ 6
 * BeschV)": it states what the law requires, so it needs the law beside it.
 *
 * The SECOND part is additive, and it is the quotation-mark test, kept. Kind
 * alone cannot reach the slots that declare none — a route's summary, a
 * criterion's `short_reason`, a threshold's row label, a statutory citation, a
 * field's own wording. Nothing in the data says what those are, so the only
 * check left is the one a reader would make: whatever you put between
 * quotation marks, somebody has to be shown to have said.
 *
 * Both are written over the TEXT, not the fields: moving a sentence to another
 * slot is not a way to silence either.
 */
export function quotedWithoutProvenance(dataset: Dataset): QuotationOffence[] {
  const out: QuotationOffence[] = [];
  for (const t of renderableTexts(dataset)) {
    // Declared ours. The declaration is the attribution, and it is recorded in
    // the data and shown on the card — never a blank a rule taught somebody to
    // leave.
    if (t.kind === "ours") continue;

    if (t.kind === "authority" && !t.quote && !t.declared_absence) {
      out.push({ ...t, reason: "no-source" });
      continue;
    }

    if (!QUOTATION_MARK.test(t.text)) continue;
    const spans = quotedSpans(t.text);
    if (!spans.length) { out.push({ ...t, reason: "unbalanced" }); continue; }
    if (!t.quote) { out.push({ ...t, reason: "no-source" }); continue; }
    const source = flatten(t.quote);
    if (spans.some((s) => !source.includes(s))) out.push({ ...t, reason: "quote-does-not-cover" });
  }
  return out;
}
