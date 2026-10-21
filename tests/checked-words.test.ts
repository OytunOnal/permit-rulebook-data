import { describe, expect, it } from "vitest";
import dataset from "../data/dataset.json" with { type: "json" };
import { renderableTexts } from "../src/index.js";
import type { Dataset } from "../src/index.js";

const ds = dataset as unknown as Dataset;

/**
 * GLOSSARY's Scope statement avoid-list: the model's words, kept in code and on
 * `/data/`, never in front of a reader (#151).
 */
const SCOPE_STATEMENT_AVOID_LIST = ["scored", "this interview", "rule set"] as const;
const avoidListWordsIn = (text: string): string[] =>
  SCOPE_STATEMENT_AVOID_LIST.filter((word) => text.toLowerCase().includes(word));

describe("#153 — the scope line in the reader's words", () => {
  it("no text the dataset puts in front of a reader carries a word on the avoid-list", () => {
    const offending = renderableTexts(ds)
      .filter((t) => avoidListWordsIn(t.text).length > 0)
      .map((t) => `${t.path}: ${avoidListWordsIn(t.text).join(", ")}`);
    expect(offending).toEqual([]);
  });
});
