import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { validateDataset } from "../src/validate.js";
import { CONSOLIDATED_TEXT_HOSTS, hostKindOf, renderableTexts, routeStatements } from "../src/index.js";
import type { Dataset } from "../src/types.js";
import { routeOf } from "./route-of.js";

const ds = dataset as unknown as Dataset;
const clone = (): Dataset => JSON.parse(JSON.stringify(dataset)) as Dataset;

/**
 * #158 — a link to a consolidated text says so.
 *
 * The site labels a link by whose page it opens: an authority's own, or a
 * consolidated text someone else publishes. The data package holds the two
 * host lists and says which kind a source's host is; a source on a host on
 * neither list is a page nobody has classified, and the gate stops it.
 */

/** A host on neither list. */
const UNLISTED = "https://mirror.example.org/18g_AufenthG.htm";

describe("the kind of a source's host", () => {
  it("names an authority's own page", () => {
    expect(hostKindOf("https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Migrathek/BlaueKarteEU/blauekarteeu-node.html"))
      .toBe("authority");
  });

  it("names a consolidated text", () => {
    expect(hostKindOf("https://www.buzer.de/18g_AufenthG.htm")).toBe("consolidated-text");
  });

  it("throws on a host on neither list, naming it", () => {
    expect(() => hostKindOf(UNLISTED)).toThrow(/mirror\.example\.org/);
  });

  it("throws on an address that is not https, whatever host it names", () => {
    for (const url of ["http://www.bamf.de/", "javascript://www.bamf.de/%0aalert(1)", "ftp://www.buzer.de/18g_AufenthG.htm"])
      expect(() => hostKindOf(url), url).toThrow(/https/);
  });
});

describe("a citation names the statute, and the host kind discloses the mirror", () => {
  it("no legal_basis names a consolidated-text host", () => {
    const hosts = CONSOLIDATED_TEXT_HOSTS.map((h) => h.replace(/^www\./, ""));
    const citations = renderableTexts(ds).filter((t) => t.path.endsWith("/legal_basis"));
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations)
      for (const host of hosts) expect(c.text, c.path).not.toContain(host);
  });
});

describe("the gate: every source host is on a list", () => {
  const listErrors = (d: Dataset) => validateDataset(d).errors.filter((e) => e.keyword === "listedLinkHost");

  it("refuses a statement quoted from a host on neither list", () => {
    const bad = clone();
    const statement = routeStatements(routeOf(bad, "de-chancenkarte")).find((s) => s.source)!;
    statement.source!.source_url = UNLISTED;
    const result = validateDataset(bad);
    expect(result.ok).toBe(false);
    expect(listErrors(bad).map((e) => e.message).join("\n")).toContain("mirror.example.org");
  });

  it("and a question's learn link on such a host", () => {
    const bad = clone();
    bad.fields.find((f) => f.learn)!.learn!.url = UNLISTED;
    expect(validateDataset(bad).ok).toBe(false);
    expect(listErrors(bad).map((e) => e.message).join("\n")).toContain("mirror.example.org");
  });

  it("passes the shipped dataset", () => {
    expect(listErrors(ds)).toEqual([]);
    expect(validateDataset(ds).ok).toBe(true);
  });
});
