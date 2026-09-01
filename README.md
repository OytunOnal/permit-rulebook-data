# visa-rules

Open, dated, source-quoted work-permit rules dataset for Europe, plus the
deterministic engine that evaluates eligibility over it. Single source of
truth for [visa-navigator](../visa-navigator) (and later JobRadar).

**Judgment lives in code, language lives in the model:** eligibility is
computed with `if`, never asked of an LLM. Every numeric value in the dataset
carries its official source URL, a verbatim quote, the retrieval date and its
change history. A value without provenance fails schema validation and cannot
build.

## Layout

- `schema/ruleset.schema.json` — the public contract (JSON Schema 2020-12)
- `data/de.json` — dataset (S1: Germany, EU Blue Card only)
- `src/engine.ts` — evaluation: band derivation, met/near/hold, gap analysis
- `src/questions.ts` — question set derived from rule predicates (never desyncs)
- `src/validate.ts` — boundary validation

## Commands

```
npm run build     # tsc → dist/
npm run validate  # schema-check data/*.json, ndjson logs
npm test          # vitest
npm run check     # all of the above
```

## Data durability

The dataset lives as JSON in git; git history **is** the durability story.
Values are never edited destructively: a change moves the old value into the
`history` array with its retrieval date, appends the new one, and lands as a
commit — an append-only audit trail ("changed from €39,582 to €41,100 on
2026-08-24, quote attached") reconstructible at any commit. There is no
database and no backup problem: cloning the repo is the backup.

## Licence

Code MIT. Dataset (`data/`) CC-BY-4.0 — use it, cite it.
