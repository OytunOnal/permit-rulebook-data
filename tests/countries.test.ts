import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, referencedFields, unlocks } from "../src/engine.js";
import { deriveQuestions, remainingQuestions } from "../src/questions.js";
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

  it("the destination question opens the flow (ask_first pin beats greedy ordering)", () => {
    expect(remainingQuestions(dataset, {})[0].field).toBe("destination");
  });

  it("review catch: a €40k German offer is 'near' the €45,630 route even though other countries' thresholds landed in between", () => {
    const r = byId({
      destination: "de", citizenship: "third_country", situation: "offer",
      qualification: "degree", occupation_it: "no", experience: "y2in5",
      salary_eur_year: "band_1", // €39,582 – €41,356.36 — two pooled bands below €45,630
    });
    expect(r["de-experienced-worker"].status).toBe("near");
    expect(r["de-experienced-worker"].gap_max).toBeCloseTo(45630 - 39582, 2);
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
    // Bounded-gap semantics: a declared band with a finite ceiling below the
    // threshold is "within reach" with an honest gap — never silent hold.
    expect(r["fr-talent-blue-card"].status).toBe("near");
    expect(r["fr-talent-blue-card"].gap_max).toBeCloseTo(59373 - 39582, 2);
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
      nl_recent_grad: "no", top200_grad: "yes",
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

describe("NL Blue Card — the IT experience rule (human verification 2026-09-04)", () => {
  const itPro: Profile = {
    destination: "nl", citizenship: "third_country", situation: "offer",
    qualification: "none", occupation_it: "yes", experience: "y2in5",
    age_band: "a30to35", salary_eur_month: "band_4",
  };

  it("an IT professional with 3 years in the last 7 meets it without a degree", () => {
    expect(byId({ ...itPro, experience_7y: "yes" })["nl-blue-card"].status).toBe("met");
  });

  it("without that experience the route is honestly held, never assumed", () => {
    expect(byId({ ...itPro, experience_7y: "no" })["nl-blue-card"].status).toBe("hold");
  });

  it("non-IT applicants are never asked the 7-year question", () => {
    const { asked } = runFlow({
      destination: "nl", citizenship: "third_country", situation: "offer",
      qualification: "degree", age_band: "a30to35", salary_eur_month: "band_4",
      experience: "y2in5",
    });
    expect(asked).not.toContain("experience_7y");
  });

  it("a German applicant never sees it either (pruning, not luck)", () => {
    const { asked } = runFlow({
      destination: "de", citizenship: "third_country", situation: "offer",
      qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
      experience: "y2in5", salary_eur_year: "band_4",
    });
    expect(asked).not.toContain("experience_7y");
    expect(asked.length).toBeLessThanOrEqual(8);
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
  it("NL under-30 salary shortfall: both routes are 'near' with honest gaps — the strip carries them, unlocks never duplicate", () => {
    const stuck: Profile = {
      destination: "nl", citizenship: "third_country", situation: "offer",
      age_band: "u30", qualification: "degree", experience: "y2in5",
      salary_eur_month: "band_2", // €1,867.02 – €4,357: below both NL thresholds
    };
    const baseline = byId(stuck);
    expect(baseline["nl-hsm-under30"].status).toBe("near");
    expect(baseline["nl-hsm-under30"].gap_max).toBeCloseTo(4357 - 1867.02, 2);
    expect(baseline["nl-blue-card"].status).toBe("near"); // bounded even two bands down
    expect(baseline["nl-blue-card"].gap_max).toBeCloseTo(5942 - 1867.02, 2);
    // Nothing here is on hold, so the salary field must produce no unlock rows.
    const rows = unlocks(dataset, stuck);
    expect(rows.filter((u) => u.field === "salary_eur_month")).toEqual([]);
  });

  it("destination=all explorer: offer/ict steps fork per country via the situation_country qualifier", () => {
    // Everything a CK-style interview would have asked is answered; salary and
    // country-specific fields are not — so only qualification-gated routes can prove out.
    const allExplorer: Profile = {
      destination: "all", citizenship: "third_country", situation: "none",
      qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
      experience: "y2in5", german: "b1", funds_eur_month: "band_1",
      nl_recent_grad: "no", top200_grad: "no",
    };
    const rows = unlocks(dataset, allExplorer);
    const forked = rows.filter((u) => u.qualifier?.field === "situation_country");
    expect(forked.length).toBeGreaterThan(0);
    // "a job offer — in Germany" provably opens §18b (no salary threshold).
    const offerDe = forked.find((u) => u.option.value === "offer" && u.qualifier!.option.value === "de")!;
    expect(offerDe.routes.map((r) => r.route.id)).toContain("de-skilled-academic");
    // "an intra-corporate transfer — in Spain" opens es-ict (degree, no threshold).
    const ictEs = forked.find((u) => u.option.value === "ict" && u.qualifier!.option.value === "es")!;
    expect(ictEs.routes.map((r) => r.route.id)).toEqual(["es-ict"]);
    // Salary-gated routes (NL HSM, FR talent, Blue Cards) never appear unproven.
    for (const u of forked)
      for (const r of u.routes)
        expect(["nl-hsm-30plus", "nl-hsm-under30", "nl-blue-card", "fr-talent-qualifie"]).not.toContain(r.route.id);
  });

  it("destination=de explorer: no qualifier rows — localization passes via destination alone", () => {
    const deExplorer: Profile = {
      destination: "de", citizenship: "third_country", situation: "none",
      qualification: "degree", recognition_de: "recognized", occupation_shortage: "yes",
      experience: "y2in5", german: "b1", funds_eur_month: "band_1",
      salary_eur_year: "band_4",
    };
    const rows = unlocks(dataset, deExplorer);
    expect(rows.some((u) => u.option.value === "offer" && !u.qualifier)).toBe(true);
    expect(rows.every((u) => u.qualifier === undefined)).toBe(true);
  });

  it("explorer bound for NL: no DE-only unlock suggestions (german never suggested)", () => {
    const nlExplorer: Profile = {
      destination: "nl", citizenship: "third_country", situation: "none",
      nl_recent_grad: "no", top200_grad: "no",
    };
    const rows = unlocks(dataset, nlExplorer);
    expect(rows.every((u) => u.field !== "german")).toBe(true);
  });
});

describe("the orientation year asks two plain questions (s5b, critique #6)", () => {
  it("a top-200 degree alone meets the route — the Dutch-graduate answer is not needed", () => {
    const profile: Profile = {
      destination: "nl", citizenship: "third_country", situation: "none", top200_grad: "yes",
    };
    expect(byId(profile)["nl-orientation-year"].status).toBe("met");
  });

  it("a Dutch graduate alone meets it too", () => {
    const profile: Profile = {
      destination: "nl", citizenship: "third_country", situation: "none", nl_recent_grad: "yes",
    };
    expect(byId(profile)["nl-orientation-year"].status).toBe("met");
  });

  it("\"I don't know\" on the ranking leaves the route undecided, never failed", () => {
    const r = byId({
      destination: "nl", citizenship: "third_country", situation: "none",
      nl_recent_grad: "no", top200_grad: "unknown",
    })["nl-orientation-year"];
    expect(r.status).toBe("hold");
    expect(r.hard_fail).toBe(false);
    expect(r.unknown_fields).toContain("top200_grad");
  });

  it("both questions are asked as separate, single-condition questions", () => {
    const labels = Object.fromEntries(
      deriveQuestions(dataset).map((q) => [q.field, q.label]),
    );
    // The property, not the copy: one institution class per question, so a
    // reworded label (the IND page frames foreign schools as "designated",
    // not "top 200" — human check 2026-09-04) doesn't fail the intent.
    expect(labels["nl_recent_grad"]).toMatch(/Dutch/);
    expect(labels["nl_recent_grad"]).not.toMatch(/foreign|designated|top 200/i);
    expect(labels["top200_grad"]).toMatch(/foreign|designated/i);
    expect(labels["top200_grad"]).not.toMatch(/Dutch/);
    for (const f of ["nl_recent_grad", "top200_grad"])
      expect(labels[f]).toMatch(/last 3 years/);
  });
});
