# s5e human verification checklist — the quotes no machine here can read (curated 2026-09-07)

s5e attached a source, a verbatim quote and a read date to every sentence a card
can render. **78 of those quotes are now machine-verified** on each `npm run
check`: the gate finds the sentence on the snapshot of the page it cites, or the
build fails. **Six are not**, and they are all on the same two PDFs. This file
is that list, and nothing else — it is short because the cost the scenario
priced in did not fall due: the German BAMF pages, the Spanish BOE and every
IND route page answer this host in full today, so their quotes went to the
machine tier instead (see "What did not need a human" below).

**Read section 4 before trusting section 3.** The reassurance section 3 offered
about the IND pages was wrong, and the correction is what the slice markers on
those entries are for.

Real-green needs a human pass over the six items in the first section. A
mismatch → fix the dataset quote (move the old one into `history`), re-run
`npm run check`, and record the catch in the navigator's DECISIONS.md.

## 1. Quotes that need a person — PDF tier (6) — READ 2026-09-07

**All seven items read on 2026-09-07 by the session, from the PDFs' own text layers** —
both files carry embedded TrueType fonts, and decoding their glyph tables yields
the full text; the "scanned image" premise was wrong for the UGE PDF. The
leaflet states "Stand: April 2026"; the UGE PDF states "Junio 2026". Every
sentence below was found verbatim by string match, not by eye. The PDFs and
decoded text sit in the session scratchpad; the decoder is a candidate for the
watch (see DECISIONS 2026-09-07).

The quote gate reports each of these as `unverifiable — pdf tier — no text
snapshot`, never as verified. Only the byte-hash of the PDF is watched, so a
re-typeset PDF with the same words looks like a change and a reworded one with
the same bytes cannot happen.

### Chancenkarte leaflet — German embassy Cairo (`de-chancenkarte`)

https://kairo.diplo.de/resource/blob/2664804/5e952d2720a91e83a475a3e02452f1cf/250122-deu-merkblatt-chancenkarte-data.pdf

- [x] **NEW with s5e.** Backs the qualification condition (`qualification in
      [vocational, degree]`). Find this sentence and confirm it word for word:
      "einen ausländischen Hochschulabschluss, einen mindestens zweijährigen
      Berufsabschluss (jeweils im Ausbildungsstaat staatlich anerkannt)"
      **A pass:** the words appear in that order in the leaflet's list of what
      counts as a qualification. **A fail:** the leaflet lists different
      qualification types, or has been replaced by a newer Merkblatt — in which
      case the quote is stale and the condition needs re-reading against § 20a
      AufenthG, which this host CAN read.
- [x] Standing since s5c. Backs the €1,091/month livelihood threshold:
      "Für den Aufenthalt in Deutschland müssen Ihnen monatlich mindestens
      1.091 Euro zur Verfügung stehen."
      **A pass:** the amount and the sentence both match.
      **A fail:** the figure is indexed and moves — put the old amount into the
      threshold's `history` with its old `retrieved_at`, set the new one, and
      re-run `npm run check`. If the leaflet is gone rather than changed, the
      figure has no source at all: § 20a AufenthG (which this host CAN read)
      states the requirement but not the amount, so the card must lose the
      number rather than keep an unsourced one.

### UGE salary-threshold PDF — Spanish ministry (`es-blue-card`, `es-highly-qualified`)

https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf

Standing since s5; re-listed here because the gate still reports them and the
size of this list has to be honest. **First, confirm the PDF you open is dated
"Junio 2026".** If it is not, every item below is a fail for the same reason
and the whole block needs re-reading against the new edition — say so once
rather than three times.

Three of the four items below are salary rails on a card. A wrong one does not
misinform a reader mildly; it tells them they qualify when they do not, or the
reverse. The fourth is the wording that says who may be offered the reduced
rail at all — also on this PDF, and also read here.

- [x] `es-blue-card` general threshold. Find this sentence and confirm it word
      for word:
      "Nuevos umbrales salariales Tarjeta Azul. – Umbral general: 41.356,36 €"
      **A pass:** the words and the figure both match, in that order.
      **A fail:** the figure has moved (the INE publishes a new average salary
      around May–June and the new threshold applies one month later — see the
      derivation note below). Then: put 41.356,36 into the threshold's
      `history` with its old `retrieved_at`, set the new amount, quote and read
      date, and re-run `npm run check`. The same figure also backs
      `es-highly-qualified`; the build fails if you update one copy and not the
      other, which is the gate doing its job, not a second bug.
- [x] `es-blue-card` reduced threshold:
      "– Umbral reducido: 33.085,09 €"
      **A pass:** the words and the figure match, and the reduced umbral is still stated as its own figure — the June 2026 edition gives no proportion for it, only for the general threshold.
      **A fail:** as above, plus one case worth naming — if the PDF has started
      to limit the reduced threshold to qualifications from particular
      institutions, that is not a number change but a rule change. Do not edit
      the amount; record it and raise it, because the reading
      `salary-figures-and-their-limits-read-by-a-person` on that card now tells
      the reader that this PDF names no institution at all — see the next item,
      which is where those words are.
- [x] **NEW 2026-09-07.** `es-blue-card:reduced-also-for-shortage-occupations` —
      not an amount but the conditions the reduced amount is offered under,
      which the caveat on that card states in plain English. Find this passage
      and confirm it word for word:
      "¿Cuándo se aplica el umbral reducido? El umbral reducido podrá
      aplicarse en los siguientes supuestos: – Ocupaciones de difícil
      cobertura incluidas en los grupos 1 y 2 de la CNO-2011, conforme a la
      normativa vigente. – Personas nacionales de terceros países que hayan
      obtenido la cualificación requerida en los tres años previos a la
      solicitud de la Tarjeta Azul-UE."
      **A pass:** both bullets appear under that question, in those words.
      Two artefacts of the file, not of the wording: the PDF's text stream
      repeats the page footer "Junio 2026" between the two bullets, and its
      glyph table renders "¿Cuándo" as "¿Ouándo" (and "PAC nacional" as "PAO
      nacional" further down). The quote above is corrected for both, and the
      `legal_basis` beside it says so.
      **A fail:** a limb has been added, removed or narrowed — that is a rule
      change, not a quote to reword. The card models the recent-qualification
      limb as a number and ships the shortage-occupation limb as this caveat
      and nothing else, so either way: record it and raise it.
- [x] `es-highly-qualified` single threshold:
      "Se establece un umbral único de 41.356,36 €"
      **A pass:** the words match and the threshold is still described as
      **único** — one figure with no reduced version.
      **A fail:** if a reduced version has appeared, this route now has a
      disjunction it does not model. Record it and raise it; do not add a
      second threshold from this checklist.

### One thing to read while you have the PDF open (not a shipped quote)

- [x] The derivation sentence that explains why these figures move. It shipped
      inside an unsourced criterion note until s5e and was removed rather than
      given provenance it could not carry; the reading on each Spanish card now
      says only that a person read the number by hand.
      Look for: "El Instituto Nacional de Estadística (INE) publicó el pasado
      28 de mayo de 2026 el dato actualizado del sueldo medio correspondiente a
      2024, fijándolo en 29.540,26 €" and the rule in Orden PJC/44/2026 art. 3.2
      that the new threshold applies one month after publication.
      **If it still reads that way**, nothing to do. **If the INE has published
      a newer average**, both Spanish thresholds are about to move and the
      watch flag will not tell you — this sentence is the only warning.

## 2. Decisions a human may want to reverse (Group A)

Each of these was our own reasoning stated as a fact about the rule. The
scenario allowed three outcomes — sourced, demoted, or deleted — and this is
which one each got. Reversing any of them is a data edit, not a code change.

| Was | Where | Outcome |
| --- | --- | --- |
| "When changing employer after turning 30, the €5,942.00 amount applies" | `nl-hsm-under30` | **Sourced.** Now a caveat on the card carrying the IND table row that says it. |
| "Recognised by the state where it was acquired — German recognition not required (§ 6 BeschV)" | `de-experienced-worker` | **Sourced** from § 6 Abs. 1 Satz 1 Nr. 3 Buchst. a BeschV. |
| "Waived when the employer is collectively bound (tarifgebunden, §§ 3, 5 TVG)" | `de-experienced-worker` | **Deleted.** The route already shipped the same fact as a sourced caveat quoting the ZAV page; the note was a second, unsourced copy. |
| "IND also applies a market-rate test" | `nl-hsm-30plus` | **Sourced.** The route's plain precondition about market rate now carries the IND sentence; added to `nl-hsm-under30` too, which had the same precondition and no quote. |
| "Grants, stipends or own savings also count toward sufficient income" | `nl-researcher` | **Sourced** as a caveat from the IND researcher page. The second half ("gross SV salary without holiday allowance") was **deleted**: the threshold's own quote already says it. |
| "IND: a minimum of 3 years of relevant work experience … for IT managers" | `nl-blue-card` | **Sourced.** Replaced by the IND page's own sentence, verbatim. |
| "The fiche frames this as a resources proof … SMIC-indexed" | `fr-ict` | **Demoted** to a route reading — it is our reading of how the figure behaves, and it says so on the card. |
| "the page body is client-rendered and cannot be machine-read" | `nl-blue-card` | **Deleted as false.** See below. |

## 3. What did not need a human

The scenario expected the German hosts, the Spanish UGE and the client-rendered
IND pages to force a large human tier. Measured from this host on 2026-09-07,
only the two PDFs did. Every one of these answered a plain fetch with its full
requirement list, and every quote taken from them is machine-verified:

- bamf.de — four route pages (graduate, vocational, researcher, ICT)
- buzer.de — § 6 BeschV, § 20a AufenthG
- boe.es — Ley 14/2013 consolidated
- ind.nl — highly skilled migrant, Blue Card, ICT, researcher, orientation year
- service-public.gouv.fr, arbeitsagentur.de — already watched

Two watch entries moved **off** the human tier as a result
(`nl-ind-orientation-year`, `nl-ind-blue-card`). Their notes recorded that IND
route pages render client-side and that our fetch saw a 1.4 kB shell.

## 4. Correction (2026-09-07, review): the shell is still there, and the gate was pointed the wrong way

The paragraph that stood here said that if the shell came back "the quotes will
go missing loudly, which is what the gate is for". **That was wrong, and it was
wrong in the direction that costs data.**

What actually happens on a shell response, traced through `src/watch/core.ts`:

1. The shell answers **200**. `runWatch` only reports `unreachable` when the
   fetch itself fails, so the shell is hashed like any other page.
2. The hash differs from the snapshot, so the entry reports **`changed`** —
   the same outcome as a page that was genuinely rewritten.
3. Under `--commit`, the 1.4 kB shell is written into `state.json` as `text`.
4. The next `npm run check` then reports **every quote on that page as
   `missing`** — and "missing" is the signal that says *the page no longer
   says this, go and rewrite the dataset*.

Around half of the 78 verified quotes are IND-hosted. A curator following that
flag faithfully would have overwritten correct, verified data because a page
failed to render once.

**What was done instead.** Every IND and BAMF page on the watchlist now carries
a `slice: {from, to}` around its operative region — the requirement list on the
route pages, the paid-employment section on the amounts page, the article body
on BAMF. The mechanism already existed and already said what it does: *a
missing marker reports as unreachable — never as "no change"*. A shell carries
neither marker, so the entry reports `unreachable`, the snapshot is not
touched, and the quotes stay verified against the last good text. Tested end to
end in `tests/watch.test.ts` ("a page that answers with a shell is unreachable,
not changed"), including the counterfactual: the same shell without the marker
still reports `changed`, which is what makes the marker worth having.

**Still unexplained, and a human should know it:** a bare fetch of the
orientation-year URL returned the 1.4 kB shell twice on 2026-09-07, with and
without a browser User-Agent, and returned the full 34 kB page later the same
day from the same host. Nobody has established why. **An intermittent shell is
worse than a permanent one** — a permanent one is noticed immediately; an
intermittent one waits for a `--commit` run. Nothing here fixes IND's
behaviour; it makes the watch honest about it.
