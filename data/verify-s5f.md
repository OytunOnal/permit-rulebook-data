# s5f human verification checklist — the Spanish verdicts that moved (curated 2026-09-07)

> **Walked 2026-09-07 by the session, at the human's delegation** ("e bunları
> sen yapabilirsin"). Recorded in DECISIONS: this is the scenario's real-green
> condition met by the party that built the slice, not by an independent
> reader. Method: the ten profiles reconstructed from the rows below and run
> through the engine with the two-year and the three-year answer (all 15 rows
> reproduced exactly, 0 worse); rows 2 and 13 entered by hand in the live
> interview and their cards read. Result: **15 / 15 yes; section 2 pass.** One
> new finding on the row-13 card, outside this file's question, is in section 4.

s5f's decision 1 gave the `experience` question a three-year answer, and the
s5f review round made two more changes on the same axis: `y3in7` now declares
the two-year band it clears (`implies`), and `es-ict` reads the three years its
own quote states (Ley 14/2013 art. 73.2.b) instead of five. Every one of those
is a verdict change, and the scenario's real-green says a person reads the moved
verdicts **as a list** and agrees each moved the right way.

This file is that list. It is not a task for the machine: `npm run check` is
green, the direction is proved over 600 generated profiles in
`tests/s5f.test.ts`, and the counts below are pinned in `tests/s5e.test.ts`.
What no test can do is agree that a person in this position *should* see what
they now see. That is what section 1 asks for.

## How the list was made — and why it is not the 400-profile digest

The digest over 400 seeded profiles cannot answer this question. Adding an
option to the ladder changes what the generator DRAWS, so comparing the old
digest with the new one puts 400 people against 400 *different* people:
different profiles, not different rules. (The s5f commit reported 27 moved rows
and the pin's comment said 26; neither is reproducible by any method, and the
test comment now says so.)

The population is held fixed instead, and split by what the person answered:

- **318 of the 400 profiles answered an option the ladder already had**
  (`lt2`, `y2in5`, `y5in7`, or left the question unanswered). Under the old
  rules and the new ones, **every route gives every one of them the same row —
  0 moved, on any route, in either direction.** Nothing below concerns them,
  and nothing needs checking for them. That is decision 1's "every other route
  keeps its verdicts", measured with no route exempted.
- **82 of the 400 answered the new `y3in7`.** Their honest baseline is the same
  person answering `y2in5` — the rung below on the same ladder, which is what
  they would have had to say before the option existed. **15 rows differ, and
  none is worse.** Those 15 are section 1.

Reproduce: `npm test` (the counts are asserted), or read the differential test
in `tests/s5e.test.ts` — "and when it moves, the differential holds the
population fixed".

## What the two movements mean on a card

Two kinds of movement appear below, and the second is the one that needs a
careful eye.

- **`hold (hard fail)` → `met`** — the route now says criteria met. Two rows.
- **`hold (hard fail)` → `hold`** — the route is still not met, but it stopped
  being *dead*. A hard fail is a route that no remaining unanswered question
  could ever rescue; without the hard fail the route stays open, the interview
  keeps asking about it, and the card shows what is still short instead of a
  closed door. Thirteen rows. **This is a move toward the reader only if the
  route really is still reachable for that person** — that is the judgement
  being asked for.

## 1. The 15 moved rows — READ AND AGREE

Ten distinct profiles make the 15 rows: five move on BOTH Spanish routes, two
on `es-highly-qualified` only, three on `es-ict` only. The five that appear
twice are cross-referenced in the second table. The profiles are randomly
seeded, so a few are odd people (a destination of Spain with the offer in
Germany, a salary left unanswered); that is the population being honest, not a
bug — the point is that the RULE moved them, and the same rule moves real
people the same way.

Every row's answer to the experience question is **"3+ years within the last
7"**. The comparison is always against the same person answering **"2+ years
within the last 5"**.

### `es-highly-qualified` — 7 rows

Decision 1: art. 71.2 counts three years, and the route now reads the answer
that says so.

| # | The person, in their own answers | From | To | Moved toward the reader? |
| --- | --- | --- | --- | --- |
| 1 | Destination Spain · the offer is in Germany · no completed qualification · €33,085.09–€39,582 | hold (hard fail) | hold | **yes** |
| 2 | Samoan passport · destination Spain · has a job offer there · the offer is in Spain · vocational training, 2+ years · €45,630–€45,934.20 | hold (hard fail) | **met** | **yes** |
| 3 | Has a job offer · the offer is in Spain · vocational training, 2+ years · under €33,085.09 · (destination not answered) | hold (hard fail) | hold | **yes** |
| 4 | "Any of these four — show me everything" · the offer is in Spain · vocational training, 2+ years · €50,700–€59,373 | hold (hard fail) | hold | **yes** |
| 5 | Comorian passport · destination Spain · the offer is in Spain · no completed qualification · €41,356.36–€45,630 | hold (hard fail) | hold | **yes** |
| 6 | Grenadian passport · destination Spain · vocational training, 2+ years · €33,085.09–€39,582 | hold (hard fail) | hold | **yes** |
| 7 | Vietnamese passport · destination Spain · no completed qualification · €45,934.20–€50,700 | hold (hard fail) | hold | **yes** |

**Walked:** row 2 entered in the interview (Samoa · Spain · offer · vocational ·
3+ years · €45,630–€45,934.20): card reads CRITERIA MET, the rail marks
€41,356.36 as "the one salary amount on this route" with "your band" above it,
the art. 71.2 three-year quote is on the card, and the UGE precondition sits
under "Also required — not checked here". Rows 1, 3–7: engine, hold without
the hard fail, same person two-year answer dead — toward the reader.

**A pass, for every row:** three years of related experience is *more* than two,
and this route's own source says three is what it wants — so the person who
declared three can only be better off than the person who declared two. Row 2
in particular: open the card and confirm the route really is met (offer in
Spain, vocational qualification, salary at or above the €41,356.36 único
threshold), not met by accident.

**A fail:** any row where the three-year answerer ends up worse than the
two-year answerer, or where "met" is reached without the salary threshold being
cleared. Either is a rule bug, not a wording problem — stop and raise it.

### `es-ict` — 8 rows

The review round's H1: the criterion said `experience eq y5in7` while its own
quote said *"una experiencia profesional de al menos 3 años"* (art. 73.2.b). A
verdict its own quote refutes. These eight rows are that correction landing.

| # | The person, in their own answers | From | To | Moved toward the reader? |
| --- | --- | --- | --- | --- |
| 8 | Destination Spain · the offer is in Germany · no completed qualification · €33,085.09–€39,582 *(same person as row 1)* | hold (hard fail) | hold | **yes** |
| 9 | Malaysian passport · employer is transferring them to a branch · the transfer is to Germany · vocational training, 2+ years · €39,582–€41,356.36 · (destination not answered) | hold (hard fail) | hold | **yes** |
| 10 | "Any of these four — show me everything" · the offer is in Spain · vocational training, 2+ years · €50,700–€59,373 *(same person as row 4)* | hold (hard fail) | hold | **yes** |
| 11 | Comorian passport · destination Spain · the offer is in Spain · no completed qualification · €41,356.36–€45,630 *(same person as row 5)* | hold (hard fail) | hold | **yes** |
| 12 | "Any of these four — show me everything" · employer is transferring them to a branch · vocational training, 2+ years · €33,085.09–€39,582 | hold (hard fail) | hold | **yes** |
| 13 | Cape Verdean passport · destination Spain · employer is transferring them to a branch · vocational training, 2+ years · (salary not answered) | hold (hard fail) | **met** | **yes** |
| 14 | Grenadian passport · destination Spain · vocational training, 2+ years · €33,085.09–€39,582 *(same person as row 6)* | hold (hard fail) | hold | **yes** |
| 15 | Vietnamese passport · destination Spain · no completed qualification · €45,934.20–€50,700 *(same person as row 7)* | hold (hard fail) | hold | **yes** |

**Walked:** row 13 entered in the interview (Cape Verde · Spain · transfer ·
vocational · 3+ years): the interview stopped after five answers without
asking salary, because no live route needed it; card reads CRITERIA MET, its
description says "There is no salary threshold beyond the collective agreement
for the job", and the last line says "No salary or points threshold on this
route — nothing here to fall short of". Both preconditions (real business
activity; three months with the group) are under "Also required — not checked
here". Rows 8–12, 14, 15: engine, hold without the hard fail — toward the
reader.

**A pass, for every row:** the BOE article this route cites asks for three
years, so a person declaring three years must not be failed on experience. Row
13 in particular: this route has no salary threshold of its own beyond the
collective agreement for the job, so "met" with the salary question unanswered
is expected here — check that the card says that plainly rather than implying a
salary was checked.

**A fail:** if the human reading of art. 73.2.b is that the three years must be
*inside the group* rather than in the occupation generally, then the option's
wording ("3+ years within the last 7") does not carry that condition and the
criterion is answering a question the article did not ask. That is a rule
finding, not a number: record it and raise it. Do not edit the quote.

## 2. The translation check — one entry, side by side

The scenario's real-green also asks the human to "read one translated decision
against its Turkish original and confirm the argument is the same". Decision 4
allows no improvement: *a translation that improves a decision's argument has
changed the record.*

**Read this one:**

> `## 2026-09-02 — s3b "Leverage analysis" (a mini slice born from a human question) 🛑→✅`
> — line 245 of `DECISIONS.md` in the navigator repo.

The translation held the line numbering, so the Turkish original of this entry
starts at **line 245 of the old file too**: the two can be read side by side
without hunting.

It is a good test because it is an argument, not a status line: a mini slice
that existed only because the human asked a question, so the reasoning is the
whole entry — and its heading was translated too, from `s3b "Kaldıraç analizi"
(insan sorusundan doğan mini dilim)`.

The Turkish original, run in the navigator repo:

```
git show 7c075a0:DECISIONS.md
```

**Correction to the brief.** The original is **not** at `6ca0e92^`. Commit
`6ca0e92` touched only `src/lib/card.ts`, `tests/card.test.ts` and
`tests/s5e.test.ts`, despite its message saying "docs translated to English" —
the translation actually landed two commits earlier, in `3aec601`, whose parent
is `7c075a0`. At `6ca0e92^` `DECISIONS.md` is already English, so that command
would show the human two English copies. `git show 3aec601^:DECISIONS.md` is
the same file and also works.

**A pass:** the English entry makes the same argument, reaches the same
decision, and claims no more than the Turkish did.

**Read 2026-09-07 (session):** both versions of the s3b entry side by side,
paragraph by paragraph — birth, decision (1) and (2), the in-slice honesty
rule, the v0.5 extension, the second extension and the ADR pointer. Same
argument, same decisions, same hedges ("can be discussed later" kept; "not
predicted (fortune-telling)" kept); nothing sharpened, nothing dropped, the
commit hashes identical. **Pass.**

**A fail:** the English is *better reasoned* than the Turkish — a gap the
translation filled, a hedge it dropped, a conclusion it sharpened. That is a
changed record, and the fix is to weaken the English back to what was decided,
not to leave the improvement in.

## 3. What this file does not cover

- **The German routes.** `de-experienced-worker` and the Chancenkarte points
  ladder give the `y3in7` answerer exactly what the `y2in5` answerer gets —
  same status, same points — because the option declares the band it clears.
  Nothing moved *between* the two answers there, so there is nothing to read.
  (Before the review round they did move, and the wrong way: the honest
  three-year answer failed the route and scored 0 where two years scored 2.
  That was the regression; it is fixed and guarded over 600 profiles.)
- **The five-year criteria.** `nl-blue-card` and `es-blue-card` still read
  `y5in7` alone, still fail the three-year answer, and are right to: their
  sources say five.
- **Quote fidelity.** Every quote on both Spanish routes is machine-verified on
  each `npm run check` (120 verified, 0 missing, 0 unverifiable,
  `human_tier: 0`). The human tier closed in s5f; its record is
  `data/verify-s5e.md`.

## 4. Found on the way — not this file's question

The row-13 card quotes the same sentence twice: *"La existencia de una relación
laboral o profesional, previa y continuada, de 3 meses con una o varias de las
empresas del grupo"* (art. 73.2.c) appears once as the source of the
`situation eq ict` criterion and once as the source of the precondition
"Three months of prior and unbroken work with one or more companies of the
group". The precondition is where that sentence belongs; the criterion — "is
your employer transferring you to a branch there" — is carrying the wrong
quote, and the card shows the duplication. No verdict is affected. Filed on
the board as a dataset bug with the fix named; not a bar to this real-green.
