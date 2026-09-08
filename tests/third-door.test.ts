import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UNKNOWN_BAND, deriveQuestions, remainingQuestions } from "../src/questions.js";
import { evaluate, referencedFields } from "../src/engine.js";
import { answerLabel, liveUnknowns, reasonFor } from "../src/verdict.js";
import { proseProvenance, renderableTexts } from "../src/prose.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/**
 * A money question was worded for a situation the reader had already ruled out,
 * and offered no way to say so (isolated v1-gate critique, 2026-09-08, F11).
 *
 * A woman who had declared a job offer at question 2 was asked, at question 11,
 * for "monthly funds you can evidence for the job-search stay" — two amounts and
 * no third answer. A man whose contract stays with his employer abroad was asked
 * for the salary "in the offer" he had just said he does not have. Both had to
 * answer something untrue or stop.
 *
 * So: no money question describes a situation the reader may not be in, and
 * every one of them has a door that is neither a number nor a lie. Answering
 * that door leaves the rules undecided — an open gap, which is what it is — and
 * never turns into a no.
 */

const MONEY = dataset.fields.filter((f) => f.type === "money_band");

describe("a money question fits whoever is answering it", () => {
  it("describes the money, not a situation the reader may have ruled out", () => {
    for (const field of MONEY) {
      const said = `${field.label} ${field.subject ?? ""}`;
      for (const untrue of ["in the offer", "in your offer", "job-search stay"])
        expect(said.toLowerCase(), `${field.id}: "${untrue}"`).not.toContain(untrue);
      // "Evidence" is a noun in this product; the verb is the source language
      // showing through.
      expect(said.toLowerCase(), `${field.id}: evidence as a verb`).not.toContain("you can evidence");
    }
  });

  it("offers a third door, once, and calls it something a reader can pick", () => {
    for (const q of deriveQuestions(dataset)) {
      const def = dataset.fields.find((f) => f.id === q.field)!;
      if (def.type !== "money_band") continue;
      const doors = q.options.filter((o) => o.value === UNKNOWN_BAND);
      expect(doors.length, `${q.field}: no third door`).toBe(1);
      expect(doors[0]!.label.length, `${q.field}: an unlabelled door`).toBeGreaterThan(3);
      // It is last: the amounts are what most readers answer.
      expect(q.options[q.options.length - 1]!.value, q.field).toBe(UNKNOWN_BAND);
    }
  });

  it("taking it leaves the rules undecided, never failed", () => {
    for (const field of MONEY) {
      const profile: Profile = {
        destination: "de", citizenship: "third_country", situation: "offer",
        qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
        experience: "y2in5", german: "b1", [field.id]: UNKNOWN_BAND,
      };
      for (const r of evaluate(dataset, profile)) {
        const asks = r.criteria.filter((cr) => referencedFields(cr.criterion).includes(field.id));
        for (const cr of asks)
          expect(cr.outcome, `${r.route.id}: ${field.id}=${UNKNOWN_BAND} read as a verdict`).not.toBe("fail");
        // And where nothing else has already settled the route against them,
        // it says so rather than staying silent: an open gap, not a no.
        const hardFailed = r.criteria.some((cr) => cr.outcome === "fail");
        if (asks.length && r.status === "hold" && !hardFailed)
          expect(liveUnknowns(r, profile), `${r.route.id}`).toContain(field.id);
      }
    }
  });

  it("the answer is quoted back in the words the button used", () => {
    for (const field of MONEY) {
      const q = deriveQuestions(dataset).find((x) => x.field === field.id)!;
      const door = q.options.find((o) => o.value === UNKNOWN_BAND)!;
      expect(answerLabel(dataset, field.id, UNKNOWN_BAND)).toBe(door.label);
    }
  });

  it("and the reason names it as an open gap rather than a no", () => {
    const profile: Profile = {
      destination: "de", citizenship: "third_country", situation: "offer",
      qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
      experience: "y2in5", german: "b1", salary_eur_year: "band_4", funds_eur_month: UNKNOWN_BAND,
    };
    const card = evaluate(dataset, profile).find((r) => r.route.id === "de-chancenkarte")!;
    const said = reasonFor(dataset, card, profile);
    expect(said.rows.some((row) => row.kind === "unknown"), "the open answer is not reported").toBe(true);
    expect(said.line).toContain("open gap");
  });

  it("the interview still ends, with the door taken every time", () => {
    const profile: Profile = { destination: "de", citizenship: "third_country" };
    for (let step = 0; step < 40; step++) {
      const next = remainingQuestions(dataset, profile)[0];
      if (!next) break;
      const def = dataset.fields.find((f) => f.id === next.field)!;
      profile[next.field] = def.type === "money_band"
        ? UNKNOWN_BAND
        : next.options[0]!.value;
    }
    expect(remainingQuestions(dataset, profile), "the interview never ends").toEqual([]);
  });
});

/**
 * The door is a button a reader reads, so its words belong to the dataset and
 * to the gate that checks the dataset's words — not to a default buried in the
 * question layer where nothing could see them (Standards review, 2026-09-08).
 */
describe("the door's words are the dataset's, and the gate sees them", () => {
  it("every money field names its own door", () => {
    for (const field of MONEY)
      expect(field.unknown_label, `${field.id} leans on the code default`).toBeTruthy();
  });

  it("and each one reaches the prose gate as a label", () => {
    const texts = renderableTexts(dataset);
    for (const field of MONEY) {
      const seen = texts.find((t) => t.path.endsWith(`/unknown_label`) && t.text === field.unknown_label);
      expect(seen, `${field.id}: its door reaches no gate`).toBeDefined();
      expect(seen!.kind, field.id).toBe("label");
    }
  });

  it("and is counted with the rest of our prose", () => {
    const before = proseProvenance(dataset).ours;
    const fewer = JSON.parse(JSON.stringify(dataset)) as Dataset;
    delete fewer.fields.find((f) => f.id === "funds_eur_month")!.unknown_label;
    expect(proseProvenance(fewer).ours).toBe(before - 1);
  });
});
