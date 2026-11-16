import { describe, expect, it } from "vitest";
import { SCREEN_PLACE_PHRASES } from "../src/index.js";
import { textsCheckedForScreenPlace } from "../src/screen-place.js";
import { validateDataset } from "../src/validate.js";
import type { Dataset } from "../src/types.js";
import { readJson } from "./read-json.js";
import { routeOf } from "./route-of.js";

const dataset = readJson("../data/dataset.json") as Dataset;

/** The paths of the errors the dataset check reports on `ds`. */
const refusedPaths = (ds: Dataset): string[] => validateDataset(ds).errors.map((e) => e.path);

/**
 * No sentence a reader is shown points at a place on the screen
 * (OytunOnal/permit-rulebook#409): a notice and a route statement are drawn on
 * the result screen and on a route page alike, and a route page has no answer,
 * no questions and no routes above or below it.
 */
describe("the dataset check refuses screen-place words", () => {
  it("refuses each phrase of the declared set in a notice's title, a notice's body and a statement's text", () => {
    expect(SCREEN_PLACE_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of SCREEN_PLACE_PHRASES) {
      const inTitle = structuredClone(dataset);
      const titled = inTitle.notices![0]!;
      titled.title = `${titled.title}, as the ${phrase} say`;
      expect(refusedPaths(inTitle), phrase).toContain(`/notices/${titled.id}/title`);

      const inBody = structuredClone(dataset);
      const bodied = inBody.notices![0]!;
      bodied.body = `${bodied.body} See the ${phrase}.`;
      expect(refusedPaths(inBody), phrase).toContain(`/notices/${bodied.id}/body`);

      const inStatement = structuredClone(dataset);
      const statement = routeOf(inStatement, "nl-ict").statements![0]!;
      statement.text = `${statement.text} — see the ${phrase}`;
      expect(refusedPaths(inStatement), phrase).toContain(`/countries/NL/routes/nl-ict/statements/${statement.id}/text`);
    }
  });

  it("lets a legal test above and a comparison below a wage stand", () => {
    const ds = structuredClone(dataset);
    const statement = routeOf(ds, "nl-ict").statements![0]!;
    statement.text = `${statement.text} — the test above; a salary below the French minimum wage`;
    expect(validateDataset(ds).errors).toEqual([]);
  });

  it("passes the shipped dataset, having read every notice's title and body and every statement's text", () => {
    // Three notices, a title and a body each, and 112 route statements.
    expect(textsCheckedForScreenPlace(dataset).length).toBe(3 * 2 + 112);
    expect(validateDataset(dataset).errors).toEqual([]);
  });
});
