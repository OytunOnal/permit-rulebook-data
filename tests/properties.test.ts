import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { deriveBands, evaluate, unlocks } from "../src/engine.js";
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
  return (def.options ?? []).map((o) => o.value);
}

function randomProfile(rand: () => number, answerProb = 1): Profile {
  const p: Profile = {};
  for (const def of dataset.fields) {
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
  it("holds for 300 random answer-oracles", () => {
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
  it("met = all pass; near = only gapped fails, nothing undecided (2000 random profiles)", () => {
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

      for (const def of dataset.fields) {
        if (def.kind !== "path" && def.kind !== "improvable") continue;
        const current = p[def.id];
        if (current === undefined) {
          expect(rows.some((u) => u.field === def.id)).toBe(false);
          continue;
        }
        const candidates = def.type === "money_band"
          ? deriveBands(dataset, def.id).map((b) => ({ value: b.id, is_unknown: false, is_fallback: false }))
          : (def.options ?? []).map((o) => ({ value: o.value, is_unknown: !!o.is_unknown, is_fallback: !!o.is_fallback }));
        for (const cand of candidates) {
          const row = rows.find((u) => u.field === def.id && u.option.value === cand.value);
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
    }
  });
});

describe("property: when the interview ends, no unanswered question could change any verdict", () => {
  it("holds for 200 completed random flows", () => {
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
