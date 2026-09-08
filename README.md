# Permit Rulebook — the data

[![The results screen the dataset produces: three German routes open, each rule
answered against what the reader declared, every value carrying the authority's
quote and the day it was read](docs/media/results-2026-09-08.png)](https://permitrulebook.com)

**Every route, quoted and dated.** This repository is the ruleset and the
engine behind [permitrulebook.com](https://permitrulebook.com): 23
employment-based routes across Germany, France, Spain and the Netherlands,
every value carrying the authority's own sentence, the page it came from and
the day it was read, re-read daily.

**Who it is for.** Anyone who needs the rules themselves rather than a verdict —
a researcher, a relocation team, another site. The data is open, the engine is
deterministic, and both are usable without the site.

**What it does now** — the latest line of the versions ledger
([KANBAN.md](https://github.com/OytunOnal/permit-rulebook/blob/master/KANBAN.md),
`## versions`, in the site repository):

> **v0.10** — Launch-readiness sweep: Spain measured against three years on
> two routes (es-highly-qualified, es-ict); the experience ladder made ordinal
> (y3in7 implies y2in5) after the review caught a regression the guard could
> not see; pdf-text watch strategy — human tier 0, quotes verified 78 → 120;
> 37 bare preconditions given a kind (34 sourced, 2 ours, 1 deleted as
> repealed law); every document on disk English. Real-green walked by the
> session at the human's delegation. 323 + 70 tests. (2026-09-07)

**How to run it** — tried from a fresh clone on 2026-09-08:

```
git clone https://github.com/OytunOnal/permit-rulebook-data.git && cd permit-rulebook-data && npm ci && npm run check
```

That builds, validates the dataset against the schema, checks watch coverage
both ways and runs the suite.

**Feedback.** A wrong value, a route that is missing, a rule read wrongly: the
[issue tracker](https://github.com/OytunOnal/permit-rulebook-data/issues/new/choose),
under `bug`, `design-flaw` or `new-need`.
[CONTRIBUTING.md](CONTRIBUTING.md) says how a value changes and what a pull
request must carry.

**Licence.** Code MIT ([LICENSE](LICENSE)); the dataset in `data/` is
[CC BY 4.0](data/LICENSE) — use it, cite it, link back. Third-party material
and the terms it carries are listed in [NOTICE](NOTICE). [Sponsor this
work](https://github.com/sponsors/OytunOnal) — small, optional, and not what
the site runs on.

## What "quoted and dated" means here

Judgment lives in code, language lives in the model: eligibility is computed
with `if`, never asked of an LLM. Every value in the dataset carries its
official source URL, a verbatim quote, the retrieval date and its change
history. A value without provenance fails schema validation and cannot build.
Every route also declares its scope, and the page says it in the reader's own
words: *quoted and dated · scored against your answers*, *quoted and dated ·
scored, two conditions stated but not asked* (or *… and one in our own
reading*, where what is not asked is our reading rather than the source's), or *quoted and
dated · not scored* — together with the ids of the limbs it names and never
asks. A route with no such declaration fails
validation too, and the limbs are held against `data/exclusions.md` in both
directions.

Permit Rulebook makes no immigration decision and no authority is bound by
these results — it compares published values with what you declare, nothing
more.

## How it is put together

The site that reads this data lives in the
[permit-rulebook](https://github.com/OytunOnal/permit-rulebook) repository;
this one is the data and the engine, usable on its own. The shape of the two,
the boundary between them and what crosses it:
[docs/spine/ARCHITECTURE.md](https://github.com/OytunOnal/permit-rulebook/blob/master/docs/spine/ARCHITECTURE.md).

- `schema/ruleset.schema.json` — the public contract (JSON Schema 2020-12)
- `data/dataset.json` — the dataset (DE · FR · ES · NL, 23 employment-based routes)
- `data/exclusions.md` — every researched-but-excluded route with its reason, plus the machine-readable twin the build checks it against
- `src/engine.ts` — evaluation: band derivation, met/near/hold, gap analysis
- `src/questions.ts` — question set derived from rule predicates (never desyncs)
- `src/validate.ts` — boundary validation
- `src/watch/` — the daily source watch: what changed, and what stayed the same

```
npm run build     # tsc → dist/
npm run validate  # schema-check data/*.json, ndjson logs
npm test          # vitest
npm run check     # all of the above, plus watch coverage and prose provenance
```

## Data durability

The dataset lives as JSON in git; git history **is** the durability story.
Values are never edited destructively: a change moves the old value into the
`history` array with its retrieval date, appends the new one, and lands as a
commit — an append-only audit trail ("changed from €39,582 to €41,100 on
2026-08-24, quote attached") reconstructible at any commit. There is no
database and no backup problem: cloning the repo is the backup.
