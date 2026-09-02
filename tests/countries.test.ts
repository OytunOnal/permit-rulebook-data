import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, referencedFields, unlocks } from "../src/engine.js";
import { remainingQuestions } from "../src/questions.js";
import type { Dataset, Profile } from "../src/types.js";

const dataset = JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8")) as Dataset;

/** Greedy wizard simulation: always answer the first remaining question. */
function runFlow(answers: Profile): { asked: string[]; profile: Profile } {
  const profile: Profile = {};
  const asked: string[] = [];
  for (let i = 0; i < 50; i++) {
    const remaining = remainingQuestions(dataset, profile);
    if (remaining.length === 0) break;
    const q = remaining[0];
    if (answers[q.field] === undefined) throw new Error(`persona has no answer for ${q.field}`);
    asked.push(q.field);
    profile[q.field] = answers[q.field];
  }
  return { asked, profile };
}

const byId = (profile: Profile) =>
  Object.fromEntries(evaluate(dataset, profile).map((r) => [r.route.id, r]));

/** Fields referenced ONLY by one country's routes (its exclusive question set). */
function exclusiveFields(code: string): Set<string> {
  const mine = new Set<string>();
  const others = new Set<string>();
  for (const country of dataset.countries)
    for (const route of country.routes)
      for (const f of route.criteria.flatMap((c) => referencedFields(c)))
        (country.code === code ? mine : others).add(f);
  return new Set([...mine].filter((f) => !others.has(f)));
}

describe("scenario s5 — one interview, four countries", () => {
  it("dataset carries DE, FR, ES and NL", () => {
    expect(dataset.countries.map((c) => c.code).sort()).toEqual(["DE", "ES", "FR", "NL"]);
  });

  it("NL engineer, 28, €4,500/month offer: under-30 HSM met, 30+ HSM dead, DE routes never asked about", () => {
    const { asked, profile } = runFlow({
      destination: "nl", citizenship: "third_country", situation: "offer",
      age_band: "u30", salary_eur_month: "band_3", // €4,357 – €5,942
      qualification: "degree", experience: "y2in5",
    });
    const r = byId(profile);
    expect(r["nl-hsm-under30"].status).toBe("met");
    expect(r["nl-hsm-30plus"].status).toBe("hold"); // age path dead
    expect(r["nl-blue-card"].status).toBe("near");  // €5,942 gap is bounded
    expect(asked).not.toContain("german");          // DE-only fields never asked
    expect(asked).not.toContain("recognition_de");
    expect(asked).not.toContain("fr_degree");
  });

  it("FR young graduate: French master's + €40k offer meets talent salarié qualifié", () => {
    const r = byId({
      destination: "fr", citizenship: "third_country", situation: "offer",
      qualification: "degree", fr_degree: "yes",
      salary_eur_year: "band_1", // €39,582 – €41,356.36
    });
    expect(r["fr-talent-qualifie"].status).toBe("met");
    expect(r["fr-talent-blue-card"].status).toBe("hold"); // €59,373 gap unbounded from band_1
  });

  it("ES offer at €45k with a degree: Blue Card and PAC nacional both met", () => {
    const r = byId({
      destination: "es", citizenship: "third_country", situation: "offer",
      qualification: "degree", experience: "y2in5",
      salary_eur_year: "band_2", // €41,356.36 – €45,630
    });
    expect(r["es-blue-card"].status).toBe("met");
    expect(r["es-highly-qualified"].status).toBe("met");
  });

  it("NL explorer with a fresh top-200 degree: orientation year met without any money question", () => {
    const { asked, profile } = runFlow({
      destination: "nl", citizenship: "third_country", situation: "none",
      nl_grad3y: "yes_top200",
    });
    expect(byId(profile)["nl-orientation-year"].status).toBe("met");
    expect(asked).not.toContain("salary_eur_month");
    expect(asked).not.toContain("funds_eur_month"); // DE Chancenkarte money never asked
  });

  it("destination=all shows every country's routes for an ICT transferee", () => {
    const r = evaluate(dataset, {
      destination: "all", citizenship: "third_country", situation: "ict",
      situation_country: "de",
    });
    const alive = r.filter((x) => x.status !== "hold").map((x) => x.route.id);
    expect(alive).toContain("de-ict-card"); // localized to DE via situation_country
    // The other countries' ICT routes fail only on localization — visible as hold with that reason.
    expect(r.find((x) => x.route.id === "nl-ict")).toBeDefined();
  });
});

describe("invariant — destination pruning", () => {
  const cases: Array<[string, string]> = [
    ["de", "DE"], ["fr", "FR"], ["es", "ES"], ["nl", "NL"],
  ];
  for (const [dest, code] of cases) {
    it(`destination=${dest} never asks another country's exclusive questions`, () => {
      const foreign = new Set<string>();
      for (const other of dataset.countries)
        if (other.code !== code)
          for (const f of exclusiveFields(other.code)) foreign.add(f);
      // Walk every remaining question from the bare destination answer: none may be foreign-exclusive.
      const remaining = remainingQuestions(dataset, { destination: dest }).map((q) => q.field);
      for (const f of remaining) expect(foreign, `asked foreign field ${f} for ${dest}`).not.toContain(f);
    });
  }
});

describe("invariant — DE verdicts are country-independent", () => {
  // The same DE profile must reach identical DE-route statuses whether the user
  // chose Germany alone or asked for all four countries.
  const profiles: Profile[] = [
    { citizenship: "third_country", situation: "offer", qualification: "degree",
      recognition_de: "recognized", occupation_shortage: "yes", experience: "y2in5",
      salary_eur_year: "band_4", situation_country: "de" },
    { citizenship: "third_country", situation: "none", qualification: "degree",
      recognition_de: "recognized", german: "a1", funds_eur_month: "band_1" },
    { citizenship: "third_country", situation: "ict", situation_country: "de" },
  ];
  for (const [i, p] of profiles.entries()) {
    it(`profile ${i + 1}: destination de vs all agree on every DE route`, () => {
      const de = byId({ ...p, destination: "de" });
      const all = byId({ ...p, destination: "all" });
      for (const route of dataset.countries.find((c) => c.code === "DE")!.routes) {
        expect(all[route.id].status, route.id).toBe(de[route.id].status);
        expect(all[route.id].gap_max, route.id).toBe(de[route.id].gap_max);
        expect(all[route.id].gap_points, route.id).toBe(de[route.id].gap_points);
      }
    });
  }
});

describe("unlocks across countries", () => {
  it("NL under-30 salary gap: the HSM route is already 'near' (strip, not unlock); a higher band unlocks the Blue Card", () => {
    const stuck: Profile = {
      destination: "nl", citizenship: "third_country", situation: "offer",
      age_band: "u30", qualification: "degree", experience: "y2in5",
      salary_eur_month: "band_2", // €1,867.02 – €4,357: adjacent to the under-30 threshold
    };
    const baseline = byId(stuck);
    expect(baseline["nl-hsm-under30"].status).toBe("near"); // bounded gap keeps it on the strip
    const rows = unlocks(dataset, stuck);
    const salaryRows = rows.filter((u) => u.field === "salary_eur_month");
    expect(salaryRows.length).toBeGreaterThan(0);
    const targets = salaryRows.flatMap((u) => u.routes.map((r) => r.route.id));
    expect(targets).toContain("nl-blue-card"); // hold → provably opened by the salary step
    expect(targets).not.toContain("nl-hsm-under30"); // never duplicated: it was never on hold
  });

  it("explorer bound for NL: no DE-only unlock suggestions (german never suggested)", () => {
    const nlExplorer: Profile = {
      destination: "nl", citizenship: "third_country", situation: "none", nl_grad3y: "no",
    };
    const rows = unlocks(dataset, nlExplorer);
    expect(rows.every((u) => u.field !== "german")).toBe(true);
  });
});
