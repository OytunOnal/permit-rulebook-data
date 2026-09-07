import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, forEachCriterion, unlocks } from "../src/engine.js";
import { deriveQuestions } from "../src/questions.js";
import { validateDataset } from "../src/validate.js";
import { answerLabel, criterionPhrase, reasonFor, shortLabelOf, subjectOf, unlockTitleOf } from "../src/verdict.js";
import type { Dataset, FieldDef, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function optionValues(def: FieldDef): string[] {
  if (def.type === "money_band") return deriveBands(dataset, def.id).map((b) => b.id);
  return fieldOptions(dataset, def.id).map((o) => o.value);
}

function randomProfile(rand: () => number, answerProb = 1): Profile {
  const p: Profile = {};
  for (const def of dataset.fields)
    if (rand() < answerProb) {
      const vals = optionValues(def);
      p[def.id] = vals[Math.floor(rand() * vals.length)];
    }
  return p;
}

/** Everything a person could read on a result screen for one profile. */
function userFacingFor(profile: Profile): string[] {
  const out: string[] = [];
  for (const r of evaluate(dataset, profile)) {
    const reason = reasonFor(dataset, r, profile);
    out.push(reason.line, ...reason.rows.map((x) => x.text));
    out.push(r.route.name, ...(r.route.summary ? [r.route.summary] : []), ...(r.route.preconditions ?? []));
  }
  for (const u of unlocks(dataset, profile)) out.push(unlockTitleOf(dataset, u));
  return out.filter((s) => s.length > 0);
}

/** The dataset's own prose, which reaches the screen unchanged. */
function datasetProse(): string[] {
  const out: string[] = [];
  for (const f of dataset.fields) {
    out.push(f.label, f.short_label, f.subject);
    if (f.learn) out.push(f.learn.label);
    for (const o of fieldOptions(dataset, f.id)) out.push(o.label, ...(o.short ? [o.short] : []));
  }
  for (const q of deriveQuestions(dataset)) out.push(q.label, ...q.options.map((o) => o.label));
  for (const country of dataset.countries)
    for (const route of country.routes) {
      out.push(route.name, ...(route.summary ? [route.summary] : []), ...(route.preconditions ?? []));
      forEachCriterion(route.criteria, (c) => {
        if (c.short_reason) out.push(c.short_reason);
        if (c.op === "gte" && c.threshold_label) out.push(c.threshold_label);
        if (c.op === "any") {
          if (c.label) out.push(c.label);
          for (const p of c.paths) if (p.label) out.push(p.label);
        }
      });
    }
  for (const n of dataset.notices ?? []) out.push(n.title, n.body);
  return out;
}

describe("invariant: no user-facing string contains a dataset field id", () => {
  // The permanent form of blocker B3 (product-critique v0.7): "Not met:
  // situation", "hsm salary criterion for your age", "Unknown: recognition".
  // It targets the symptom, so a new field or a new control cannot bring it
  // back — the page carries no field-id map of its own to fall through.
  const ids = dataset.fields.map((f) => f.id);
  // Ids a reader could never mistake for English. The rest ("situation",
  // "experience") are ordinary words that authored prose legitimately uses;
  // those are covered by the slot check below, which is sharper anyway.
  const identifierShaped = ids.filter((id) => /[_0-9]/.test(id));

  it("the identifier-shaped ids appear in nothing the engine can produce", () => {
    expect(identifierShaped.length).toBeGreaterThan(10);
    const rand = lcg(5150);
    for (let i = 0; i < 120; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.6);
      for (const s of userFacingFor(p))
        for (const id of identifierShaped)
          expect(s, `"${s}" leaks ${id}`).not.toContain(id);
    }
  });

  it("nor in any prose the dataset itself ships", () => {
    for (const s of datasetProse())
      for (const id of identifierShaped)
        expect(s, `"${s}" leaks ${id}`).not.toContain(id);
  });

  it("no reason ever fills a requirement or unknown slot with a field's NAME", () => {
    // The slot is where a description belongs. "Not met: situation" happened
    // because the name fell into it; naming any field there is the bug,
    // whether the name is the raw id or a tidied-up label.
    const names = new Set<string>();
    for (const f of dataset.fields) {
      names.add(f.id.toLowerCase());
      names.add(f.short_label.toLowerCase());
      names.add(f.id.replace(/_/g, " ").toLowerCase());
    }
    const rand = lcg(90210);
    for (let i = 0; i < 200; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.7);
      for (const r of evaluate(dataset, p)) {
        const { parts } = reasonFor(dataset, r, p);
        for (const phrase of [...parts.needs, ...parts.unknown, ...parts.moot])
          expect(names.has(phrase.trim().toLowerCase().replace(/\.$/, "")), `"${phrase}" on ${r.route.id}`).toBe(false);
      }
    }
  });

  it("nor does any OTHER rendered phrase turn out to BE a field id", () => {
    // What the substring check above cannot reach: seven ids are ordinary
    // English words ("situation", "experience", "german"), so prose that
    // contains one is not a leak. What is always a leak is a phrase that IS
    // one — a whole slot filled with the id itself. That is checkable for
    // every id, plain-English ones included, and it is checkable
    // EXHAUSTIVELY: every phrase-shaped slot the engine fills comes from a
    // finite set. Whole-phrase equality is the honest limit here; an id used
    // as one word inside an authored sentence stays uncoverable, which is why
    // `datasetProse` is read by a human at authoring time.
    // Case-sensitively: an id is lowercase identifier text, and a leak
    // renders it verbatim. "Destination" is the authored ledger label of the
    // field whose id happens to be the same English word — capitalised prose,
    // not an id that escaped.
    const ids = new Set(dataset.fields.map((f) => f.id));
    const slots: Array<[string, string]> = [];
    for (const f of dataset.fields) {
      slots.push([`${f.id} ledger label`, shortLabelOf(dataset, f.id)]);
      slots.push([`${f.id} subject`, subjectOf(dataset, f.id)]);
      for (const v of optionValues(f)) slots.push([`${f.id}=${v} answer`, answerLabel(dataset, f.id, v)]);
    }
    for (const country of dataset.countries)
      for (const route of country.routes) {
        slots.push([`${route.id} name`, route.name]);
        if (route.summary) slots.push([`${route.id} summary`, route.summary]);
        for (const pre of route.preconditions ?? []) slots.push([`${route.id} precondition`, pre]);
        forEachCriterion(route.criteria, (c) => slots.push([`${route.id} criterion`, criterionPhrase(dataset, c)]));
      }
    // The two slots that only exist for a person: an unlock's step and the one
    // line a card leads with.
    const rand = lcg(13579);
    for (let i = 0; i < 120; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.7);
      for (const u of unlocks(dataset, p)) slots.push([`${u.field} unlock title`, unlockTitleOf(dataset, u)]);
      for (const r of evaluate(dataset, p)) {
        const reason = reasonFor(dataset, r, p);
        slots.push([`${r.route.id} reason line`, reason.line]);
        for (const row of reason.rows) slots.push([`${r.route.id} reason row`, row.text]);
      }
    }
    expect(slots.length).toBeGreaterThan(100);
    for (const [where, phrase] of slots)
      expect(ids.has(phrase.trim().replace(/[.!?]$/, "")), `${where}: "${phrase}"`).toBe(false);
  });
});

describe("invariant: every reason a route gives is a sentence", () => {
  it("starts with a capital, ends with a full stop, and is never empty", () => {
    const rand = lcg(31415);
    for (let i = 0; i < 200; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.7);
      for (const r of evaluate(dataset, p)) {
        const reason = reasonFor(dataset, r, p);
        for (const s of [reason.line, ...reason.rows.map((x) => x.text)]) {
          expect(s.length, r.route.id).toBeGreaterThan(0);
          expect(s[0], `"${s}"`).toBe(s[0].toUpperCase());
          expect(s, `"${s}"`).toMatch(/[.!?]$/);
        }
      }
    }
  });
});

describe("s5d — modelling vocabulary is not user-facing copy", () => {
  const prose = () => [...datasetProse()];

  it("no screen calls a rule a criterion, a path or a top-200 anything", () => {
    for (const s of prose()) {
      // The singular is only ever the modelling word here; "entry criteria" in
      // the Türkiye note is ordinary English and stays.
      expect(s, s).not.toMatch(/\bcriterion\b/i);
      expect(s, s).not.toMatch(/\b(reduced|salary|full) criteri(on|a)\b/i);
      expect(s, s).not.toMatch(/\bdisjunction\b/i);
      expect(s, s).not.toMatch(/\bsecond path\b/i);
      // The IND stopped saying "top 200"; so did we (human check 2026-09-04).
      expect(s, s).not.toMatch(/\btop.?200\b/i);
    }
  });

  it("every abbreviation a first-time reader cannot expand is expanded where it appears", () => {
    // The verbatim quotes are exempt: they are evidence, and rewriting them
    // would destroy the thing the product exists to show. Everything the
    // product writes in its own voice is not.
    const glosses: Array<[RegExp, RegExp]> = [
      [/\bIND\b/, /immigration service/i],
      [/\bBIG\b/, /register/i],
      [/\bBBG\b/, /pension contribution ceiling/i],
      [/\bEEA\b/, /Iceland/],
      [/\bPAC\b/, /profesional altamente cualificado/i],
      [/\bSMIC\b/, /minimum wage/i],
    ];
    for (const s of prose())
      for (const [abbr, gloss] of glosses)
        if (abbr.test(s)) expect(s, `"${s}" uses ${abbr} unexplained`).toMatch(gloss);
  });
});

describe("s5d — the reason column reads as prose (blocker B3)", () => {
  /** Walk C's profile: exploring all four, weak answers throughout. */
  const explorer: Profile = {
    destination: "all", citizenship: "US", situation: "none", qualification: "degree",
    recognition_de: "not_yet", experience: "y5in7", occupation_shortage: "unknown",
    nl_recent_grad: "no", top200_grad: "unknown", german: "a2", english: "c1",
    age_band: "u30",
  };

  it("the France block says what is needed, not which field failed", () => {
    const fr = evaluate(dataset, explorer).filter((r) => r.country === "FR");
    expect(fr.length).toBeGreaterThan(0);
    for (const r of fr) {
      const { line, parts } = reasonFor(dataset, r, explorer);
      expect(line).not.toMatch(/^Not met: /);
      // The step the person has not taken is named in their words.
      if (parts.needs.length)
        expect(parts.needs.join(" ")).toMatch(/job offer|transfer|hosting agreement|degree|contract|employer/i);
    }
  });

  it("an \"I don't know\" answer is reported as a sentence about the fact, not the field", () => {
    const withUnknown = evaluate(dataset, explorer).filter((r) => reasonFor(dataset, r, explorer).parts.unknown.length);
    expect(withUnknown.length).toBeGreaterThan(0);
    for (const r of withUnknown)
      for (const u of reasonFor(dataset, r, explorer).parts.unknown)
        expect(u, r.route.id).toMatch(/^(whether|which|where|your|the) /);
  });
});

describe("s5d — the plain-words primitives the page renders", () => {
  it("every fact the interview can ask has a ledger label and a sentence form", () => {
    for (const q of deriveQuestions(dataset)) {
      const def = dataset.fields.find((f) => f.id === q.field)!;
      expect(def.short_label, q.field).toBeTruthy();
      expect(subjectOf(dataset, q.field), q.field).toBe(def.subject);
      expect(def.short_label, q.field).not.toBe(q.field);
    }
  });

  it("every criterion in the dataset can state what it asks for, in words", () => {
    for (const country of dataset.countries)
      for (const route of country.routes)
        forEachCriterion(route.criteria, (c) => {
          const text = criterionPhrase(dataset, c);
          expect(text.length, `${route.id}: ${JSON.stringify(c).slice(0, 80)}`).toBeGreaterThan(3);
          expect(text, route.id).not.toMatch(/undefined|\[object/);
        });
  });

  it("a criterion with no authored words for the answer it names fails the build", () => {
    // The guard that keeps the words honest: not "the page has a fallback",
    // but "there is nothing to fall back to". Strip one answer's noun phrase
    // and the dataset stops being valid.
    const broken = structuredClone(dataset);
    const situation = broken.fields.find((f) => f.id === "situation")!;
    delete situation.options!.find((o) => o.value === "offer")!.short;
    const result = validateDataset(broken);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.message).join(" ")).toMatch(/situation.*offer|offer.*situation/);
  });

  it("the shipped dataset needs no such fallback anywhere", () => {
    expect(validateDataset(dataset).ok).toBe(true);
  });

  it("the Dutch lower salary says which institution it means", () => {
    const nl = dataset.countries.find((c) => c.code === "NL")!;
    const route = nl.routes.find((r) => r.id === "nl-hsm-under30")!;
    const salary = route.criteria.find((c) => c.op === "any" && c.paths.length === 2 && c.label !== "located in the Netherlands")!;
    const text = criterionPhrase(dataset, salary);
    expect(text.toLowerCase()).toContain("dutch");
    expect(text.toLowerCase()).toMatch(/designat/);
  });
});
