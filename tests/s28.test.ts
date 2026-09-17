import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { datasetMeta } from "../src/engine.js";
import type { Dataset } from "../src/types.js";

const ds = dataset as unknown as Dataset;

/**
 * s28 — a learn link says what the reader does there, data half.
 *
 * A field's `learn` door is rendered as link text on three of the site's
 * surfaces. One label was an action (Anabin); three were statements about a
 * source, and one of those opened on "§ 18g AufenthG" — a symbol a screen
 * would want to gloss, inside a link, which is not glossed (the human's walk,
 * 2026-09-17: "bu link çok garip duruyor"). CONTRIBUTING now says what a
 * label is; this holds every field to it.
 */

/**
 * The contract's declared set: a label opens on one of these, and nothing
 * else counts as an action for this purpose. Change CONTRIBUTING first.
 */
const ACTION_VERBS = ["Check", "See", "Read", "Find"];

/** Every field that carries a door — the notice's own `learn` is a different
 * link with a different sentence around it, and is not held here. */
const doors = () => ds.fields.flatMap((f) => (f.learn ? [{ field: f.id, ...f.learn }] : []));

describe("a learn label is what the reader does there", () => {
  it("there are doors to hold", () => {
    expect(doors().length).toBeGreaterThan(0);
  });

  it("every label opens on a verb from the contract's declared set", () => {
    for (const d of doors())
      expect(
        ACTION_VERBS.some((v) => d.label.startsWith(`${v} `)),
        `${d.field}: "${d.label}" opens on none of ${ACTION_VERBS.join(" · ")}`,
      ).toBe(true);
  });

  it("no label carries the section sign — a symbol in a link would want a gloss, and a link is not glossed", () => {
    for (const d of doors()) expect(d.label, d.field).not.toContain("§");
  });

  it("is one sentence: no full stop inside it, none closing it", () => {
    // The site prints the label as the whole of a link and closes the line
    // itself; a stop inside the label would either wrap alone or double.
    for (const d of doors()) expect(d.label, d.field).not.toMatch(/\.( |$)/);
  });

  it("the four are the sentences the scenario decided", () => {
    expect(Object.fromEntries(doors().map((d) => [d.field, d.label]))).toEqual({
      recognition_de: "Check your degree in the official Anabin database",
      occupation_shortage:
        "Check the shortage groups in section 18g of the Residence Act (ISCO-08 codes 132, 133, 134, 21, 221, 222, 225, 226, 23, 25)",
      fr_innovative_employer: "See the talent card's innovative-company route on service-public.fr",
      // The scenario wrote "on the IND's orientation-year page"; the dataset's own
      // rule (s5d) expands an abbreviation wherever our voice uses it, and the
      // question above the door already says "the Dutch immigration service
      // (IND)" — the label says it the same way (corrected 2026-09-17).
      top200_grad:
        "See the designated foreign institutions on the orientation-year page of the Dutch immigration service (IND)",
    });
  });

  it("the schema did not move: a label change is a data change", () => {
    // The version is a date and already read today's (s23); the schema's own
    // `required` and `additionalProperties: false` hold a door to label + url.
    expect(datasetMeta(ds).schema_version).toBe("0.8.1");
  });
});
