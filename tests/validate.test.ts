import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertValidDataset, validateDataset } from "../src/validate.js";

const load = () =>
  JSON.parse(readFileSync(new URL("../data/dataset.json", import.meta.url), "utf8"));

describe("boundary validation (scenario step 6)", () => {
  it("the shipped dataset is valid", () => {
    const result = validateDataset(load());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("a value stripped of its quote fails, naming the field", () => {
    const data = load();
    // de-blue-card-shortage → salary criterion (last one) → threshold
    delete data.countries[0].routes[0].criteria.at(-1).threshold.quote;
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("quote"))).toBe(true);
  });

  it("a non-https source is rejected", () => {
    const data = load();
    data.countries[0].routes[0].criteria.at(-1).threshold.source_url = "http://insecure.example";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("assertValidDataset names the deepest offending path", () => {
    const data = load();
    delete data.countries[0].routes[1].criteria.at(-1).threshold.retrieved_at;
    expect(() => assertValidDataset(data)).toThrowError(/threshold.*retrieved_at|retrieved_at/);
  });

  it("a points table stripped of its source fails", () => {
    const data = load();
    const ck = data.countries[0].routes.find((r: { id: string }) => r.id === "de-chancenkarte");
    const anyC = ck.criteria.at(-1);
    delete anyC.paths[1].criteria[0].table.source_url;
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a duplicate route id across countries fails (review catch: Maps key by id)", () => {
    const data = load();
    const clone = structuredClone(data.countries[3].routes[0]);
    data.countries[1].routes.push(clone); // NL route id smuggled under FR
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "uniqueRouteId")).toBe(true);
  });

  it("a restated threshold that drifts from its twin fails (review catch: NL ICT restates HSM amounts)", () => {
    const data = load();
    const nlIct = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-ict");
    const anyC = nlIct.criteria.at(-1); // HSM-salary-by-age disjunction
    anyC.paths[0].criteria[1].threshold.retrieved_at = "2026-01-01"; // one copy updated, twin missed
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.keyword === "thresholdConsistency")).toBe(true);
  });
});

describe("s5b — notices and preconditions are data, not prose (schema boundary)", () => {
  it("a notice stripped of its quote fails", () => {
    const data = load();
    delete data.notices[0].source.quote;
    const result = validateDataset(data);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("quote"))).toBe(true);
  });

  it("an empty precondition string fails — every line must say something", () => {
    const data = load();
    const nl = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-hsm-30plus");
    nl.preconditions = ["The employer is an IND-recognised sponsor", ""];
    expect(validateDataset(data).ok).toBe(false);
  });

  it("preconditions must be strings, not structured objects", () => {
    const data = load();
    const nl = data.countries[3].routes.find((r: { id: string }) => r.id === "nl-hsm-30plus");
    nl.preconditions = [{ text: "BIG registration" }];
    expect(validateDataset(data).ok).toBe(false);
  });
});

/**
 * The provenance rule is that every value carries a source URL, a verbatim
 * quote and a retrieval date TO EXIST. `unsourced` is the one exception, and it
 * shipped as a text box with a minimum length: eleven characters of anything
 * satisfied it, which made the gate optional by prose (review 2026-09-07). The
 * genesis rule is never require content, require a DECISION — so the exception
 * is an attributable one: a reason a gate can read, and a date a human can age.
 */
describe("an absent quote is a decision, not an essay", () => {
  const statementOf = (data: any) =>
    data.countries.flatMap((c: any) => c.routes).find((r: any) => r.id === "es-blue-card").statements[0];

  /**
   * The same statement with its own quote taken off. That caveat stands on a
   * source since 2026-09-07, so a mutation that left the source in place would
   * be refused for carrying BOTH a quote and a declared absence — the wrong
   * rule, and a green that proves nothing about the one under test. Taking the
   * source off first keeps each case below testing what it says it tests.
   */
  const unquotedStatementOf = (data: any) => {
    const s = statementOf(data);
    delete s.source;
    return s;
  };

  it("prose alone fails, however much of it there is", () => {
    const data = load();
    unquotedStatementOf(data).unsourced =
      "The ministry publishes this only as a scan, and we checked again on 2026-09-07.";
    expect(validateDataset(data).ok).toBe(false);
  });

  it("prose without a reason fails — the note is in addition, never instead", () => {
    const data = load();
    unquotedStatementOf(data).unsourced = { note: "We looked hard and could not find it anywhere at all." };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason we did not enumerate fails — a gate can only read a fixed set", () => {
    const data = load();
    unquotedStatementOf(data).unsourced = { reason: "we-ran-out-of-time", checked_at: "2026-09-07" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason with no checked-on date fails — nothing a human can age", () => {
    const data = load();
    unquotedStatementOf(data).unsourced = { reason: "scanned-image" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("the date is held to the shape the sourced side is held to", () => {
    const data = load();
    unquotedStatementOf(data).unsourced = { reason: "scanned-image", checked_at: "7 September 2026" };
    expect(validateDataset(data).ok).toBe(false);
  });

  it("a reason and a date, with or without a note, is what passes", () => {
    const data = load();
    unquotedStatementOf(data).unsourced = { reason: "unreachable", checked_at: "2026-09-07" };
    expect(validateDataset(data).errors).toEqual([]);
    unquotedStatementOf(data).unsourced = {
      reason: "not-published-in-words", checked_at: "2026-09-07", note: "The list is a PDF table.",
    };
    expect(validateDataset(data).errors).toEqual([]);
  });

  it("a statement may still not carry both a quote and a reason not to have one", () => {
    const data = load();
    // Read from the sourced side now: the statement ships with a quote, and a
    // declared absence is added beside it. The rule is symmetric, and this is
    // the direction a curator can actually reach today — nothing in the
    // dataset declares an absence any more (2026-09-07).
    statementOf(data).unsourced = { reason: "unreachable", checked_at: "2026-09-07" };
    expect(validateDataset(data).ok).toBe(false);
  });
});

/**
 * A value that was read again, and did not move.
 *
 * The "value changed" half of the loop had never run before the launch, so the
 * shape of a re-read was untested: `retrieved_at` moves to the day it was read
 * and the reading it replaces goes into `history`, append-only, the same way a
 * changed value does.
 *
 * Why it was superseded is a DECLARED kind, not prose. The first version of
 * this gate accepted "any lowercase letter", which is a content check wearing
 * a schema's clothes: nothing mechanical could tell a re-read from a change,
 * and a curator writing "n/a" would have passed it (Standards review,
 * 2026-09-08).
 */
describe("a re-read is recorded like a change", () => {
  const REASONS = ["re-read-unchanged", "value-changed", "source-moved", "quote-corrected"];

  /** Every history entry in the dataset, with the live value it sits under. */
  const historiesOf = (data: {
    countries: { routes: { id: string; criteria: unknown[] }[] }[];
  }): { where: string; live: unknown; entry: Record<string, unknown> }[] => {
    const out: { where: string; live: unknown; entry: Record<string, unknown> }[] = [];
    const walk = (node: unknown, where: string): void => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${where}/${i}`));
      if (!node || typeof node !== "object") return;
      const held = node as Record<string, unknown>;
      if (Array.isArray(held["history"])) {
        const live = held["amount"] ?? held["value"] ?? held["text"];
        for (const [i, entry] of (held["history"] as Record<string, unknown>[]).entries())
          out.push({ where: `${where}/history/${i}`, live, entry });
      }
      for (const [key, value] of Object.entries(held)) if (key !== "history") walk(value, `${where}/${key}`);
    };
    walk(data.countries, "/countries");
    return out;
  };

  it("every superseded reading declares why, from the closed list, and when it was written", () => {
    for (const { where, live, entry } of historiesOf(load())) {
      expect(entry["retrieved_at"], `${where} has no date`).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      expect(REASONS, `${where}: reason ${JSON.stringify(entry["reason"])}`).toContain(entry["reason"]);
      expect(entry["checked_at"], `${where} does not say when it was written`)
        .toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      // A reading that repeats the live value did not record a change, and
      // must not claim one.
      if ((entry["amount"] ?? entry["value"] ?? entry["text"]) === live)
        expect(entry["reason"], `${where} repeats the live value and calls it a change`)
          .not.toBe("value-changed");
    }
  });

  it("the schema is the gate, not the test: an undeclared reason fails validation", () => {
    const data = load();
    const threshold = data.countries
      .flatMap((c: { routes: { id: string; criteria: Record<string, unknown>[] }[] }) => c.routes)
      .find((r: { id: string }) => r.id === "de-blue-card-general")!
      .criteria.find((c: Record<string, unknown>) => c["field"] === "salary_eur_year")!["threshold"] as
      Record<string, unknown>;
    const history = threshold["history"] as Record<string, unknown>[];
    expect(validateDataset(data).ok).toBe(true);
    history[0]!["reason"] = "because I said so";
    expect(validateDataset(data).ok, "any string passes as a reason").toBe(false);
  });

  it("the German Blue Card threshold carries the re-read the launch owed", () => {
    const data = load();
    const route = data.countries
      .flatMap((c: { routes: { id: string; criteria: Record<string, unknown>[] }[] }) => c.routes)
      .find((r: { id: string }) => r.id === "de-blue-card-general");
    const threshold = route.criteria
      .find((c: Record<string, unknown>) => c["field"] === "salary_eur_year")!["threshold"] as
      Record<string, unknown>;
    const history = threshold["history"] as Record<string, unknown>[];
    expect(history.length, "the re-read left no trail").toBe(1);
    expect(history[0]!["amount"], "the re-read invented a movement").toBe(threshold["amount"]);
    expect(history[0]!["reason"]).toBe("re-read-unchanged");
    expect(history[0]!["checked_at"]).toBe("2026-09-08");
    expect((history[0]!["retrieved_at"] as string) < (threshold["retrieved_at"] as string),
      `${history[0]!["retrieved_at"]} is not before ${threshold["retrieved_at"]}`).toBe(true);
    // The sentence the value stands on is the one that was read again.
    expect(history[0]!["quote"]).toBe(threshold["quote"]);
    expect(history[0]!["source_url"]).toBe(threshold["source_url"]);
  });
});
