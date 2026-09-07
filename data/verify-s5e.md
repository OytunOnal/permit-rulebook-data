# s5e human verification checklist — the quotes no machine here can read (curated 2026-09-07)

s5e attached a source, a verbatim quote and a read date to every sentence a card
can render. **78 of those quotes are now machine-verified** on each `npm run
check`: the gate finds the sentence on the snapshot of the page it cites, or the
build fails. **Five are not**, and they are all on the same two PDFs. This file
is that list, and nothing else — it is short because the cost the scenario
priced in did not fall due: the German BAMF pages, the Spanish BOE and every
IND route page answer this host in full today, so their quotes went to the
machine tier instead (see "What did not need a human" below).

Real-green needs a human pass over the five items in the first section. A
mismatch → fix the dataset quote (move the old one into `history`), re-run
`npm run check`, and record the catch in the navigator's DECISIONS.md.

## 1. Quotes that need a person — PDF tier (5)

The quote gate reports each of these as `unverifiable — pdf tier — no text
snapshot`, never as verified. Only the byte-hash of the PDF is watched, so a
re-typeset PDF with the same words looks like a change and a reworded one with
the same bytes cannot happen.

### Chancenkarte leaflet — German embassy Cairo (`de-chancenkarte`)

https://kairo.diplo.de/resource/blob/2664804/5e952d2720a91e83a475a3e02452f1cf/250122-deu-merkblatt-chancenkarte-data.pdf

- [ ] **NEW with s5e.** Backs the qualification condition (`qualification in
      [vocational, degree]`). Find this sentence and confirm it word for word:
      "einen ausländischen Hochschulabschluss, einen mindestens zweijährigen
      Berufsabschluss (jeweils im Ausbildungsstaat staatlich anerkannt)"
      **A pass:** the words appear in that order in the leaflet's list of what
      counts as a qualification. **A fail:** the leaflet lists different
      qualification types, or has been replaced by a newer Merkblatt — in which
      case the quote is stale and the condition needs re-reading against § 20a
      AufenthG, which this host CAN read.
- [ ] Standing since s5c. Backs the €1,091/month livelihood threshold:
      "Für den Aufenthalt in Deutschland müssen Ihnen monatlich mindestens
      1.091 Euro zur Verfügung stehen."
      **A pass:** the amount and the sentence both match.

### UGE salary-threshold PDF — Spanish ministry (`es-blue-card`, `es-highly-qualified`)

https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf

Standing since s5; re-listed here because the gate still reports them and the
size of this list has to be honest. Confirm the PDF you open says "Junio 2026".

- [ ] `es-blue-card` general threshold:
      "Nuevos umbrales salariales Tarjeta Azul. – Umbral general: 41.356,36 €"
- [ ] `es-blue-card` reduced threshold:
      "– Umbral reducido: 33.085,09 €"
- [ ] `es-highly-qualified` single threshold:
      "Se establece un umbral único de 41.356,36 €"

### One thing to read while you have the PDF open (not a shipped quote)

- [ ] The derivation sentence that explains why these figures move. It shipped
      inside an unsourced criterion note until s5e and was removed rather than
      given provenance it could not carry; the modelling statement on each
      Spanish card now says only that a person read the number by hand.
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
| "The fiche frames this as a resources proof … SMIC-indexed" | `fr-ict` | **Demoted** to a modelling statement — it is our reading of how the figure behaves, and it says so on the card. |
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
route pages render client-side and that our fetch saw a 1.4 kB shell; that is
not what this host sees now. If it becomes true again the quotes will go
missing loudly, which is what the gate is for.
