import type { Criterion, Dataset } from "./types.js";

/**
 * Every sentence the dataset ships that can reach a screen, and what provenance
 * — if any — sits beside it.
 *
 * The product's promise is that every value carries its official source, a
 * verbatim quote and the date it was read. Numbers kept that promise; sentences
 * did not, because `note` was typed as a bare string and provenance was
 * impossible there by construction. 39 of the 45 notes that shipped quoted an
 * authority; none carried a URL or a date, and the quote-fidelity gate could
 * not see one of them. Three times in two days a note turned out to be doing a
 * rule's job (s5e).
 *
 * The gate below is deliberately written over the TEXT, not over the fields:
 * moving a sentence to another slot must not be a way to silence it.
 */
export interface RenderableText {
  /** Where it lives, in dataset coordinates. */
  path: string;
  text: string;
  /** The words of the authority this sentence quotes, where one is attached. */
  quote?: string;
  /**
   * The dataset says this sentence is OURS. The only honest alternative to a
   * source: an attributable decision, recorded in the data and shown on the
   * card, rather than a blank a rule taught an agent to fill.
   */
  ours: boolean;
}

/**
 * The marks a reader takes to mean "these are somebody else's words". The
 * apostrophe is not one of them — French and Dutch prose is full of it.
 */
const QUOTATION_MARK = /["“”„‟«»‹›]/;

/** Balanced runs between those marks: what the reader is being told was said. */
const QUOTED_SPAN = /"([^"]+)"|“([^”]+)”|„([^“”]+)[“”]|«\s*([^»]+?)\s*»/g;

const flatten = (s: string): string => s.replace(/\s+/g, " ").trim();

export function quotedSpans(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(QUOTED_SPAN)) out.push(flatten(m[1] ?? m[2] ?? m[3] ?? m[4] ?? ""));
  return out.filter(Boolean);
}

/**
 * Why one sentence fails the gate — the wording a curator has to act on, so a
 * build failure never leaves "delete the quotation marks" as the obvious fix.
 */
export interface QuotationOffence extends RenderableText {
  reason: "no-source" | "quote-does-not-cover" | "unbalanced";
}

const HONEST_OPTIONS =
  'give it a source (source_url, quote, retrieved_at) whose quote contains those words, ' +
  'or move the sentence to a route statement with kind: "modelling", which says in the ' +
  "data and on the card that the words are ours. Deleting the quotation marks is not one " +
  "of the options.";

export function offenceMessage(o: QuotationOffence): string {
  const why =
    o.reason === "no-source"
      ? "quotes an authority but carries no source_url and no retrieved_at"
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
  const add = (path: string, text: string | undefined, extra: Partial<RenderableText> = {}) => {
    if (text) out.push({ path, text, ours: false, ...extra });
  };

  dataset.fields.forEach((f, i) => {
    const p = `/fields/${i}`;
    add(`${p}/label`, f.label);
    add(`${p}/short_label`, f.short_label);
    add(`${p}/subject`, f.subject);
    add(`${p}/learn/label`, f.learn?.label);
    (f.options ?? []).forEach((o, j) => {
      add(`${p}/options/${j}/label`, o.label);
      add(`${p}/options/${j}/short`, o.short);
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
    if (v) add(`${path}/legal_basis`, v.legal_basis, { quote: v.quote });
  };

  const walkCriteria = (criteria: Criterion[], base: string): void => {
    criteria.forEach((c, i) => {
      const p = `${base}/criteria/${i}`;
      // One rule throughout: a quote covers the thing it is attached to, and
      // nothing else. Prose ABOUT the criterion is covered by the criterion's
      // own source; the threshold's quote sits beside an amount and covers the
      // amount's own label and citation, below. Lending a quote sideways is
      // how a claim gets provenance it never earned.
      const quote = c.source?.quote;
      add(`${p}/note`, c.note, { quote });
      add(`${p}/short_reason`, c.short_reason, { quote });
      addBasis(`${p}/source`, c.source);
      if (c.op === "gte") {
        // The label belongs to the amount and renders on its line, so the
        // amount's quote is the provenance beside it — the same rule as the
        // citation below. Provenance covers the value it is attached to and
        // nothing else; that is what stops a quote being lent to a sentence.
        add(`${p}/threshold_label`, c.threshold_label, { quote: c.threshold.quote });
        addBasis(`${p}/threshold`, c.threshold);
      }
      if (c.op === "points") { addBasis(`${p}/required`, c.required); addBasis(`${p}/table`, c.table); }
      if (c.op === "any") {
        add(`${p}/label`, c.label, { quote });
        c.paths.forEach((path, j) => {
          add(`${p}/paths/${j}/label`, path.label, { quote });
          walkCriteria(path.criteria, `${p}/paths/${j}`);
        });
      }
    });
  };

  for (const country of dataset.countries)
    for (const route of country.routes) {
      const p = `/countries/${country.code}/routes/${route.id}`;
      add(`${p}/name`, route.name);
      add(`${p}/summary`, route.summary);
      (route.preconditions ?? []).forEach((t, i) => add(`${p}/preconditions/${i}`, t));
      (route.statements ?? []).forEach((s, i) => {
        add(`${p}/statements/${i}/text`, s.text, { quote: s.source?.quote, ours: s.kind === "modelling" });
        // The prose beside an absent quote explains what was tried. It is ours
        // by definition — and it is held to the same rule, so nobody can
        // smuggle a claim about the law into the one field that describes a
        // failure to find one.
        add(`${p}/statements/${i}/unsourced/note`, s.unsourced?.note);
        addBasis(`${p}/statements/${i}/source`, s.source);
      });
      walkCriteria(route.criteria, p);
    }

  (dataset.notices ?? []).forEach((n, i) => {
    add(`/notices/${i}/title`, n.title, { quote: n.source.quote });
    add(`/notices/${i}/body`, n.body, { quote: n.source.quote });
    addBasis(`/notices/${i}/source`, n.source);
  });

  return out;
}

/**
 * The gate: nothing reaches the screen in quotation marks without provenance
 * beside it that actually covers the words being quoted.
 *
 * Written at the symptom level on purpose. "The field is present" would have
 * been satisfied by a source attached anywhere near a sentence it does not
 * support, and it would have missed every slot nobody thought of — which is
 * the failure mode this whole slice is about.
 */
export function quotedWithoutProvenance(dataset: Dataset): QuotationOffence[] {
  const out: QuotationOffence[] = [];
  for (const t of renderableTexts(dataset)) {
    if (t.ours || !QUOTATION_MARK.test(t.text)) continue;
    const spans = quotedSpans(t.text);
    if (!spans.length) { out.push({ ...t, reason: "unbalanced" }); continue; }
    if (!t.quote) { out.push({ ...t, reason: "no-source" }); continue; }
    const source = flatten(t.quote);
    if (spans.some((s) => !source.includes(s))) out.push({ ...t, reason: "quote-does-not-cover" });
  }
  return out;
}
