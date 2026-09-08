import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, fieldOptions, isRouteAlive, notices, unlocks } from "../src/engine.js";
import { remainingQuestions } from "../src/questions.js";
import type { Dataset, FieldDef, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

// Deterministic PRNG so every run checks the same profile population.
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function optionValues(def: FieldDef): string[] {
  if (def.type === "money_band") return deriveBands(dataset, def.id).map((b) => b.id);
  // Not `def.options`: a field may declare its option list by reference
  // (`options_from`), and the engine is what expands it.
  return fieldOptions(dataset, def.id).map((o) => o.value);
}

function randomProfile(rand: () => number, answerProb = 1): Profile {
  const p: Profile = {};
  // Destination first: a money answer is a position in the ladder that
  // destination is asked, so drawing one first would put a band on a profile
  // whose own country never offers it (F12).
  const fields = [...dataset.fields]
    .sort((a, b) => Number(b.id === "destination") - Number(a.id === "destination"));
  for (const def of fields) {
    if (rand() < answerProb) {
      const vals = optionValues(def);
      p[def.id] = vals[Math.floor(rand() * vals.length)];
    }
  }
  return p;
}

function statusMap(p: Profile): Record<string, string> {
  return Object.fromEntries(evaluate(dataset, p).map((r) => [r.route.id, r.status]));
}

describe("property: the interview always terminates and never repeats a question", () => {
  it("holds for 300 random answer-oracles", { timeout: 120_000 }, () => {
    const rand = lcg(42);
    for (let i = 0; i < 300; i++) {
      const oracle = randomProfile(rand);
      const profile: Profile = {};
      const asked: string[] = [];
      for (let step = 0; step < dataset.fields.length + 1; step++) {
        const remaining = remainingQuestions(dataset, profile);
        if (remaining.length === 0) break;
        const q = remaining[0];
        expect(asked).not.toContain(q.field);
        asked.push(q.field);
        profile[q.field] = oracle[q.field];
      }
      expect(remainingQuestions(dataset, profile)).toEqual([]);
      expect(asked.length).toBeLessThanOrEqual(dataset.fields.length);
    }
  });
});

describe("property: every result status is internally consistent", () => {
  it("met = all pass; near = only gapped fails, nothing undecided (2000 random profiles)", { timeout: 120_000 }, () => {
    const rand = lcg(7);
    for (let i = 0; i < 2000; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.6);
      for (const r of evaluate(dataset, p)) {
        const fails = r.criteria.filter((c) => c.outcome === "fail");
        const unknowns = r.criteria.filter((c) => c.outcome === "unknown");
        if (r.status === "met") {
          expect(fails).toEqual([]);
          expect(unknowns).toEqual([]);
        } else if (r.status === "near") {
          expect(fails.length).toBeGreaterThan(0);
          expect(unknowns).toEqual([]);
          for (const f of fails)
            expect(f.gap_max !== undefined || f.gap_points !== undefined).toBe(true);
        } else {
          expect(fails.length + unknowns.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("property: unlock rows are SOUND and COMPLETE single-step recommendations", () => {
  it("a row exists exactly when the step opens something, and lists exactly what opens (400 random profiles)", { timeout: 120_000 }, () => {
    const rand = lcg(1337);
    for (let i = 0; i < 400; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.7);
      const baseline = statusMap(p);
      const rows = unlocks(dataset, p);

      // Qualifier rows are verified separately below; the single-step oracle
      // applies to the unqualified rows only.
      const plain = rows.filter((u) => u.qualifier === undefined);

      for (const def of dataset.fields) {
        if (def.kind !== "path" && def.kind !== "improvable") continue;
        const current = p[def.id];
        if (current === undefined) {
          expect(rows.some((u) => u.field === def.id)).toBe(false);
          continue;
        }
        if (def.type === "money_band") {
          // A number earns at most ONE step, and what makes it the right one is
          // stated as a property of the ANSWER, not as a second copy of the
          // code that picks it (Standards review, 2026-09-08): with the step's
          // band the reader meets a route they did not meet before, and with
          // any band between theirs and the step's they still do not.
          const bands = deriveBands(dataset, def.id);
          const floor = bands.find((b) => b.id === current)?.min ?? 0;
          const mine = plain.filter((u) => u.field === def.id);
          expect(mine.length, `${def.id}: ${mine.map((u) => u.option.label).join(" | ")}`)
            .toBeLessThanOrEqual(1);
          const newlyMet = (id: string) =>
            evaluate(dataset, { ...p, [def.id]: id })
              .filter((r) => r.status === "met" && baseline[r.route.id] !== "met")
              .map((r) => r.route.id);
          const step = mine[0];
          if (step) {
            const at = bands.find((b) => b.id === step.option.value)!;
            // It is above what they declared, it opens something, and the
            // routes it lists are exactly the ones it opens.
            expect(at.min, `${def.id}: ${at.label} is not above ${floor}`).toBeGreaterThan(floor);
            expect(newlyMet(at.id), `${def.id}: ${at.label} opens nothing`).not.toEqual([]);
            expect(step.routes.map((r) => r.route.id)).toEqual(newlyMet(at.id));
            // And nothing between their band and it would have done: it is the
            // nearest, so no cheaper rung was passed over.
            for (const rung of bands.filter((b) => b.min !== undefined && b.min > floor && b.min < at.min!))
              expect(newlyMet(rung.id), `${def.id}: ${rung.label} was passed over`).toEqual([]);
          } else {
            // No row means no rung above theirs opens anything at all.
            for (const rung of bands.filter((b) => b.min !== undefined && b.min > floor))
              expect(newlyMet(rung.id), `${def.id}: ${rung.label} opens a route and was not offered`)
                .toEqual([]);
          }
          continue;
        }
        const candidates = (def.options ?? [])
          .map((o) => ({ value: o.value, is_unknown: !!o.is_unknown, is_fallback: !!o.is_fallback }));
        for (const cand of candidates) {
          const row = plain.find((u) => u.field === def.id && u.option.value === cand.value);
          if (cand.value === current || cand.is_unknown || cand.is_fallback) {
            expect(row).toBeUndefined();
            continue;
          }
          const opened = evaluate(dataset, { ...p, [def.id]: cand.value })
            .filter((r) => (r.status === "met" || r.status === "near") && baseline[r.route.id] === "hold")
            .map((r) => [r.route.id, r.status]);
          if (opened.length === 0) {
            expect(row).toBeUndefined(); // no false promises
          } else {
            expect(row, `missing recommendation ${def.id}=${cand.value}`).toBeDefined(); // no missed levers
            expect(row!.routes.map((r) => [r.route.id, r.status])).toEqual(opened);
          }
        }
      }

      // Qualifier rows: SOUND — every listed route is exactly what full
      // re-evaluation under step + qualifier opens beyond the plain step; the
      // qualifier is always an unanswered plain attribute, never a second step.
      for (const u of rows) {
        if (!u.qualifier) continue;
        const qdef = dataset.fields.find((f) => f.id === u.qualifier!.field)!;
        expect(qdef.is_qualifier).toBe(true); // only dataset-marked qualifiers, never arbitrary attributes
        expect(p[u.qualifier.field]).toBeUndefined();
        const direct = new Set(
          evaluate(dataset, { ...p, [u.field]: u.option.value })
            .filter((r) => (r.status === "met" || r.status === "near") && baseline[r.route.id] === "hold")
            .map((r) => r.route.id),
        );
        const opened = evaluate(dataset, { ...p, [u.field]: u.option.value, [u.qualifier.field]: u.qualifier.option.value })
          .filter((r) => (r.status === "met" || r.status === "near") && baseline[r.route.id] === "hold" && !direct.has(r.route.id))
          .map((r) => [r.route.id, r.status]);
        expect(u.routes.map((r) => [r.route.id, r.status])).toEqual(opened);
        expect(opened.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("property: when the interview ends, no unanswered question could change any verdict", () => {
  it("holds for 200 completed random flows", { timeout: 120_000 }, () => {
    const rand = lcg(99);
    for (let i = 0; i < 200; i++) {
      const oracle = randomProfile(rand);
      const profile: Profile = {};
      for (let step = 0; step < dataset.fields.length + 1; step++) {
        const remaining = remainingQuestions(dataset, profile);
        if (remaining.length === 0) break;
        profile[remaining[0].field] = oracle[remaining[0].field];
      }
      const finalStatuses = statusMap(profile);
      for (const def of dataset.fields) {
        if (profile[def.id] !== undefined) continue;
        for (const v of optionValues(def)) {
          expect(statusMap({ ...profile, [def.id]: v })).toEqual(finalStatuses);
        }
      }
    }
  });
});

describe("property: a notice is stated only on an answer that was actually given", () => {
  it("non-empty exactly when the notice's field carries its matching value (500 random profiles)", () => {
    const rand = lcg(2026);
    for (let i = 0; i < 500; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.6);
      const matched = notices(dataset, p);
      for (const n of dataset.notices ?? []) {
        const answer = p[n.when.field];
        // s5c: an answer also carries what its option implies, so a country
        // passport matches the notice written against its class.
        const carried = answer === undefined ? [] : [answer,
          ...(fieldOptions(dataset, n.when.field).find((o) => o.value === answer)?.implies ?? [])];
        const wanted = n.when.op === "eq" ? [n.when.value] : (n.when.values ?? []);
        const applies = answer !== undefined && wanted.some((v) => v !== undefined && carried.includes(v));
        expect(matched.some((m) => m.id === n.id), `${n.id} @ ${JSON.stringify(p[n.when.field])}`).toBe(applies);
      }
    }
  });
});

describe("property: hard_fail is exactly the aliveness predicate, inverted", () => {
  it("holds for every route of 500 random profiles", () => {
    const rand = lcg(31337);
    for (let i = 0; i < 500; i++) {
      const p = randomProfile(rand, rand() < 0.5 ? 1 : 0.6);
      for (const r of evaluate(dataset, p))
        expect(r.hard_fail, r.route.id).toBe(!isRouteAlive(dataset, r.route, p));
    }
  });
});
