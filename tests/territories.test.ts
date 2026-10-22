import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { countryVocabulary, type CountryVocabulary } from "../src/countries.js";
import { findTerritory, territoryErrors, territoryPhraseOf, territoryPhraseAtStartOf } from "../src/territories.js";
import { validateDataset } from "../src/validate.js";
import { checkQuotes, datasetQuotes, datasetSourceUrls, type WatchState, type Watchlist } from "../src/watch/core.js";
import type { Dataset } from "../src/types.js";

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const dataset = readJson("../data/dataset.json") as Dataset;

/**
 * #160 — a territory typed in the passport search names its passport.
 *
 * A dependent territory is not a row of the passport list (its people hold the
 * passport of the country it belongs to), so typing its name matched nothing
 * and said nothing. The list now carries, beside the rows, the territories a
 * reader may type, each with the passport its people hold and that claim's
 * source; the package answers "which territory is this, and whose passport?"
 * and the gate holds every entry to a passport on the list, a source, and no
 * row.
 */

const SOURCE = {
  source_url: "https://example.gov/territories",
  quote: "The people of the islands are citizens of the country.",
  retrieved_at: "2026-10-21",
};

/** A small list written here, so the decisions do not hang on what ships. */
const written = (): CountryVocabulary => ({
  classes: { third_country: { label: "Other", short: "another passport" } },
  countries: [
    { code: "FI", name: "Finland" },
    { code: "US", name: "United States", article: "the", aliases: ["USA"] },
    { code: "WS", name: "Samoa" },
  ],
  territories: [
    { code: "AX", name: "Åland Islands", aliases: ["Aland", "Ahvenanmaa"], passport: "FI", source: { ...SOURCE } },
    { code: "PR", name: "Puerto Rico", passport: "US", source: { ...SOURCE } },
  ],
});

describe("the territory a reader typed, and whose passport its people hold", () => {
  it("finds a territory by its name, as typed in any case and without its marks", () => {
    const found = findTerritory("aland islands", written());
    expect(found?.territory.code).toBe("AX");
    expect(found?.country).toMatchObject({ code: "FI", name: "Finland" });
    expect(findTerritory("  Puerto Rico ", written())?.country.code).toBe("US");
  });

  it("finds it by an alias", () => {
    expect(findTerritory("Ahvenanmaa", written())?.territory.code).toBe("AX");
  });

  it("finds a territory typed with the article its name takes, as the line prints it", () => {
    const vocab = written();
    vocab.territories![0].article = "the";
    expect(findTerritory("the Åland Islands", vocab)?.territory.code).toBe("AX");
    expect(findTerritory("The Aland Islands", vocab)?.territory.code).toBe("AX");
    // An article the name does not take is not a name of it.
    expect(findTerritory("the Puerto Rico", vocab)).toBeUndefined();
  });

  it("finds nothing for a country's own name, a part of a name, or anything else", () => {
    for (const typed of ["Finland", "Puerto", "Narnia", "", "   "])
      expect(findTerritory(typed, written()), typed).toBeUndefined();
  });

  it("says a territory's name in a sentence with its article, and with a capital where it opens one", () => {
    const vocab = written();
    const ax = vocab.territories![0];
    ax.article = "the";
    expect(territoryPhraseOf(ax)).toBe("the Åland Islands");
    expect(territoryPhraseAtStartOf(ax)).toBe("The Åland Islands");
    const pr = vocab.territories![1];
    expect(territoryPhraseOf(pr)).toBe("Puerto Rico");
    expect(territoryPhraseAtStartOf(pr)).toBe("Puerto Rico");
  });

  it("finds every shipped territory by its name and each alias, with its own passport", () => {
    for (const t of countryVocabulary.territories ?? [])
      for (const name of [t.name, ...(t.aliases ?? [])])
        expect(findTerritory(name)?.country.code, name).toBe(t.passport);
  });
});

describe("the gate: a territory names a passport on the list, carries its source, and is no row", () => {
  const errorsOf = (vocab: CountryVocabulary) => territoryErrors(vocab).map((e) => e.message).join("\n");

  it("refuses a territory whose passport is not on the list", () => {
    const vocab = written();
    vocab.territories![1].passport = "XX";
    expect(errorsOf(vocab)).toMatch(/PR.*XX/);
  });

  it("refuses a territory that names no passport", () => {
    const vocab = written();
    delete (vocab.territories![1] as { passport?: string }).passport;
    expect(errorsOf(vocab)).toMatch(/PR/);
  });

  it("refuses a territory whose passport carries no source, or a source without its quote or day", () => {
    for (const strip of ["source", "quote", "retrieved_at", "source_url"]) {
      const vocab = written();
      const pr = vocab.territories![1] as unknown as Record<string, unknown>;
      if (strip === "source") delete pr.source;
      else delete (pr.source as Record<string, unknown>)[strip];
      expect(errorsOf(vocab), strip).toMatch(/PR/);
    }
  });

  it("refuses a territory whose source is not on https", () => {
    const vocab = written();
    vocab.territories![1].source.source_url = "http://example.gov/territories";
    expect(errorsOf(vocab)).toMatch(/PR.*https/);
  });

  it("refuses a territory that is a row: its code on the list, or a name the search finds a row by", () => {
    const listed = written();
    listed.territories![1].code = "US";
    expect(errorsOf(listed)).toMatch(/US/);
    const found = written();
    found.territories![0].aliases = ["Samoa"];
    expect(errorsOf(found)).toMatch(/Samoa/);
  });

  it("passes the list written here and the shipped one", () => {
    expect(territoryErrors(written())).toEqual([]);
    expect(territoryErrors(countryVocabulary)).toEqual([]);
    expect(validateDataset(dataset).errors).toEqual([]);
  });
});

describe("a territory's source is watched like a passport class's", () => {
  it("every territory's source is a dataset source, and its quote is checked against the page", () => {
    const urls = datasetSourceUrls(dataset);
    const quoted = datasetQuotes(dataset);
    for (const t of countryVocabulary.territories ?? []) {
      expect([...urls], t.code).toContain(t.source.source_url);
      expect(quoted, t.code).toContainEqual({ quote: t.source.quote, source_url: t.source.source_url, where: `territory:${t.code}` });
    }
  });

  it("the quote gate holds every territory's quote to the page it cites", () => {
    // A watch state written here, never the shipped one, which the daily run
    // rewrites: every territory's page reads its quote, and then one does not.
    const territories = countryVocabulary.territories ?? [];
    expect(territories.length, "precondition: the list carries territories").toBeGreaterThan(0);
    const watchlist: Watchlist = {
      entries: territories.map((t) => ({ id: t.code, url: t.source.source_url, strategy: "html", kind: "value-source" })),
    };
    const stateWith = (pageText: (code: string) => string): WatchState => ({
      entries: Object.fromEntries(territories.map((t) => [t.code, {
        hash: "written", retrieved_at: "2026-10-21", text: pageText(t.code), history: [],
      }])),
    });
    const territorial = (where: string) => where.startsWith("territory:");
    const quoteOf = (code: string) => territories.find((t) => t.code === code)!.source.quote;

    const read = checkQuotes(dataset, watchlist, stateWith((code) => `The page. ${quoteOf(code)} More.`));
    expect(read.missing.filter((m) => territorial(m.where))).toEqual([]);
    expect(read.unverifiable.filter((u) => territorial(u.where))).toEqual([]);

    const moved = territories[0]!.code;
    const changed = checkQuotes(dataset, watchlist,
      stateWith((code) => (code === moved ? "The page now says something else." : quoteOf(code))));
    expect(changed.missing.filter((m) => territorial(m.where)).map((m) => m.where)).toEqual([`territory:${moved}`]);
  });
});
