# Contributing to Permit Rulebook

Every route, quoted and dated. That sentence is the whole contract: nothing
enters this dataset without the authority's own words and the day someone read
them. This file says how to change a value, how to add a route, and what a pull
request has to carry.

If you only want to report something wrong, you do not need any of this — open
an issue: [bug](../../issues/new?template=bug.yml),
[design-flaw](../../issues/new?template=design-flaw.yml),
[new-need](../../issues/new?template=new-need.yml).

## Before anything: the rules the build enforces

Run `npm run check` before you push. It builds, validates the dataset against
the schema, proves every source we ship is watched (both directions), prints
the prose-provenance and quote-fidelity numbers, and runs the suite. A red
`check` is not a pull request.

Three gates will stop you, and each stops you for the same reason:

- **A value exists only with its provenance.** Source URL, verbatim quote,
  retrieval date. No exceptions for numbers.
- **A sentence a reader sees is either the authority's or declared ours.** A
  sentence stating what an authority requires must carry a covering quote, or a
  declared, dated reason there is none. Deleting the quotation marks is not a
  way past this: the gate reads the kind the slot declares, not the punctuation.
- **A route declares its scope.** See below.

## How a value changes

A threshold moved, or a page now says something different. The change is
append-only.

1. **Read the source yourself.** Open the official page or document and find
   the sentence. Not a news article about it, not a summary, not a mirror
   unless the mirror is disclosed as one on the card.
2. **Move the old value into `history`.** Never overwrite. The old entry keeps
   its own `amount`/`value`, `retrieved_at`, and — where you have it — the
   quote and URL it stood on. The audit trail is the point: a reader must be
   able to see that the figure was €39,582 until 2026-08-24 and why it moved.
3. **Write the new value with its quote.** `quote` is verbatim — the source's
   own characters, including its own thousands separator and its own language.
   Do not stitch two sentences together with an ellipsis; if one sentence does
   not carry the fact, quote the one that does.
4. **Set `retrieved_at` to the day you read it**, in ISO form (`YYYY-MM-DD`).
   Not the day the source was published, and not the day you opened the pull
   request.
5. **Let the watch re-baseline.** The daily watch compares each source against
   a stored snapshot. After a value change the next run will record a new
   baseline; if you changed the source URL, say so in the pull request so the
   snapshot is not read as a silent change.
6. **If no quote exists**, the value does not ship as a guess. A route
   statement may stand on a declared, dated absence — one of
   `scanned-image`, `not-published-in-words`, `unreachable`, plus the day you
   last looked — and the page tells the reader so in the open. A number has no
   such exception.

Where a source is one nothing here can fetch — the operative text never reaches
a machine — it belongs on the human tier, which carries a verification age and
raises reminders rather than being fetched. The tier is empty today, and adding
to it is a decision, not a fallback.

## How a route is added

1. **Check `data/exclusions.md` first.** Many routes are deliberately out —
   discretionary assessments, labour-market tests, business plans. If yours is
   listed there, the pull request that adds it starts by striking that row and
   saying what changed.
2. **Write the route against `schema/ruleset.schema.json`.** `id` is
   `<cc>-<slug>`; `name` is what the authority calls it, in English; every
   rule the interview will ask is a criterion, and every number is a threshold
   with its provenance.
3. **Anything the interview cannot ask is stated, not invented.** A condition
   the authority applies that no question can reach goes in `statements` as a
   `precondition`, with its quote. A qualification the source puts on its own
   answer goes in as a `caveat` — it fails nobody. Our own reading of the route
   goes in `readings`, where the page shows it as ours.
4. **Declare the scope statement.** Every route carries exactly one value, and
   the build fails without it:

   | value | what it says to a reader |
   |---|---|
   | `every-deciding-rule-asked` | every rule this route turns on is a question the interview asks |
   | `some-conditions-stated-not-asked` | the page states conditions the interview does not ask about, and names which |
   | `rules-quoted-nothing-asked` | the route's rules are quoted and shown; nothing on it is asked |

   Beside the value, write two things.

   `reason` is one line saying what is asked here and what is not, in the words
   the page prints — written for **this** route, not copied from its neighbour.
   It is our own sentence about our own interview, so it never states what the
   law requires; the conditions it points at carry their own quotes on the same
   page. Words a reader cannot parse do not go in it: no *modelled*, no
   *criteria*, no *scored*.

   `not_asked` is the same fact in ids: every statement and every reading this
   route names to the reader and never asks about. It is what makes the sentence
   checkable — see below.

   The value is **authored, not derived**. No test computes it from the data and
   then asserts the data agrees; that would test the derivation and leave the
   curation unexamined. What the tests hold is consistency and agreement:

   - a route that names any limb in `not_asked` may not claim
     `every-deciding-rule-asked`;
   - every limb `data/exclusions.md` records for a route must appear in that
     route's `not_asked`, and every id in `not_asked` must be a statement or a
     reading the route actually carries.

5. **Record the exclusion in both halves of `data/exclusions.md`.** The file is
   prose for a person, and it ends in a fenced ```` ```exclusions ```` block that
   says the same facts in route ids and limb ids. The two are held to each
   other: a route in the prose and missing from the block, or the other way
   round, fails the build. Name the route with its id in backticks in the prose
   row, add its line to the block, and use `(none)` where the file records a
   route in order to say nothing of it is excluded.

6. **Add every new source to the watchlist.** `npm run watch:coverage` enforces
   it in both directions: a dataset source nothing watches fails, and a watched
   source backing no value fails.
7. **Add the questions' words.** A criterion may only name an answer the
   dataset can put into words — give the option a `short`, or the criterion a
   `short_reason`. There is no fallback to a field id; the build fails instead.

## What a pull request must carry

- **What changed and why**, in one paragraph a stranger can read.
- **The source, linked**, and for every changed value the quote and the date
  you read it — in the diff, not only in the description.
- **`npm run check` green**, pasted or run in CI: schema valid, watch coverage
  both ways, quote fidelity `ok`, `human_tier: 0`, suite green.
- **A test for anything behavioural.** A rule that changed a verdict without a
  test that would have caught it going wrong is not finished.
- **No destructive edit of history.** If a diff deletes a `history` entry or
  rewrites a `retrieved_at` that was true, it will be sent back.
- **One route or one value per pull request** where you can. A sweep across
  four countries is hard to read and harder to trust.

## The three labels

The tracker carries exactly three, and they are triage, not severity:

- **`bug`** — the product does something it promised not to do: a wrong number,
  a quote that does not match its source, a page that breaks.
- **`design-flaw`** — it does what it was built to do, and what it was built to
  do is wrong: a confusing word, a control nobody can tap, a claim that
  overreaches.
- **`new-need`** — a route, a country, a fact or an export that does not exist
  yet.

## Licence

By contributing you agree that your code is released under MIT
([LICENSE](LICENSE)) and your data contributions under CC BY 4.0
([data/LICENSE](data/LICENSE)). Quoted official texts are not relicensed by
this repository — see [NOTICE](NOTICE).
