# Permit Rulebook — the data

**Every route, quoted and dated.**

An open, dated, source-quoted work-permit ruleset for four European countries —
Germany, France, Spain and the Netherlands — 23 routes, every value carrying the
authority's own sentence and the day it was read, re-read daily.

**Licence:** code MIT ([LICENSE](LICENSE)); the dataset in `data/` is
[CC BY 4.0](data/LICENSE) — use it, cite it, link back. Third-party material and
the terms it carries are listed in [NOTICE](NOTICE).

Permit Rulebook makes no immigration decision and authorities won't consider
these results — it compares published values with what you declare, nothing
more.

The site that reads this data lives in the `permit-rulebook` repository; this
one is the data and the engine, usable on its own.

## What "quoted and dated" means here

Judgment lives in code, language lives in the model: eligibility is computed
with `if`, never asked of an LLM. Every value in the dataset carries its
official source URL, a verbatim quote, the retrieval date and its change
history. A value without provenance fails schema validation and cannot build.
Every route also declares its scope, in plain words: what the interview asks of
it and what it does not — `every deciding rule asked`, `some conditions stated,
not asked`, or `rules quoted, nothing asked` — together with the ids of the
limbs it names and never asks. A route with no such declaration fails
validation too, and the limbs are held against `data/exclusions.md` in both
directions.

## Layout

- `schema/ruleset.schema.json` — the public contract (JSON Schema 2020-12)
- `data/dataset.json` — the dataset (DE · FR · ES · NL, 23 employment-based routes)
- `data/exclusions.md` — every researched-but-excluded route with its reason, plus the machine-readable twin the build checks it against
- `src/engine.ts` — evaluation: band derivation, met/near/hold, gap analysis
- `src/questions.ts` — question set derived from rule predicates (never desyncs)
- `src/validate.ts` — boundary validation
- `src/watch/` — the daily source watch: what changed, and what stayed the same

## Commands

```
npm run build     # tsc → dist/
npm run validate  # schema-check data/*.json, ndjson logs
npm test          # vitest
npm run check     # all of the above, plus watch coverage and prose provenance
```

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) says how a value changes, how a route is
added, and what a pull request must carry. Something wrong on a page or in the
data goes to the [issue tracker](https://github.com/OytunOnal/permit-rulebook-data/issues/new/choose)
under one of three labels: `bug`, `design-flaw`, `new-need`.

## Data durability

The dataset lives as JSON in git; git history **is** the durability story.
Values are never edited destructively: a change moves the old value into the
`history` array with its retrieval date, appends the new one, and lands as a
commit — an append-only audit trail ("changed from €39,582 to €41,100 on
2026-08-24, quote attached") reconstructible at any commit. There is no
database and no backup problem: cloning the repo is the backup.
