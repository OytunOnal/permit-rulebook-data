# s5e human verification checklist — the quotes no machine here can read (curated 2026-09-07)

> **CLOSED BY THE MACHINE — 2026-09-07 (s5f).** The six quotes below no longer
> need a person. The watch gained a `pdf-text` strategy that decodes a PDF's
> text layer through its own embedded fonts, both PDFs were switched to it, and
> `npm run check` now reports `human_tier: 0` with every one of these six
> sentences found in the document it cites. Two corrections fell out of the
> machine read and are recorded where they belong, not here: three quotes said
> `–` where the document encodes `-`, and the shortage-occupation caveat quoted
> across a page footer, so it was split into the two bullets it was really
> making. What the decoder gets wrong on the UGE PDF — two capital C's read as
> O — is declared by name in `src/watch/pdf-text.ts` and tested, never patched
> out of the text.
>
> This file stays as the record of what the human tier cost and how it closed.
> Nothing below is a live task.

> **REOPENED — 2026-09-10 (s8), two items, at the top of this file.** The PDF
> tier stayed closed; a different tier opened. Two of the sources behind the
> Algerian talent notice answer this host with a bot challenge rather than a
> page, so no snapshot exists to check their sentences against, and the quote
> gate reports both as `unverifiable — human tier`. They are written down
> below, one by one, with the page to open and the exact sentence to find —
> the rule this file encodes, applied to the case that reopened it. Everything
> under "1. Quotes that need a person — PDF tier" remains closed.

> **REOPENED — 2026-09-16 (s14), five pages, section 3.** The bot-gated tier
> of 2026-09-10 stayed as it was; a third kind opened. Every one of the five
> IND route pages this dataset quotes is a *"Your situation"* form now, and the
> requirements are rendered only after it is answered — at the same URL, so
> there is no address the watch could fetch. The five entries are declared
> `strategy: "human"` on the watchlist, their stale snapshots are gone from the
> state, and the quote gate reports their 38 quotes as `unverifiable — human
> tier`. They are written down under section 3, one page at a time, with the
> way through the form and the exact sentence to find.

## 0. Quotes that need a person — bot-gated web tier (2), opened 2026-09-10

Both back the notice `fr-dz-talent-open-question`, which tells a reader with an
Algerian passport that two authorities disagree and that no page found settles
it. A wrong quote here does not misinform them mildly: it is the whole of what
the notice claims either side says.

**Why a person.** Measured 2026-09-10 with this watch's own fetcher and
user-agent: Legifrance answers **HTTP 403** (with and without a trailing
slash); EUR-Lex answers **HTTP 202 with an empty body** — on this URL, on
`/EN/TXT/` without `HTML`, and on the ELI alias. The 202 is the more dangerous
of the two, because `res.ok` is true for it: the pass would have written a
blank snapshot and reported "unchanged" ever after. The fetcher now refuses an
empty body (`src/watch/cli-watch.ts`), and both entries are declared
`strategy: "human"`, `kind: "value-source"` on the watchlist, re-read quarterly.

### Conseil d'État — `notice:fr-dz-talent-open-question`

https://www.legifrance.gouv.fr/ceta/id/CETATEXT000053612496

- [x] **NEW with s8.** Read 2026-09-10. Backs the sentence saying France
  applies the 1968 agreement to Algerian nationals instead of its own code.
  Find this sentence and confirm it word for word: "Il suit de là que les
  dispositions du code de l'entrée et du séjour des étrangers et du droit
  d'asile qui sont relatives aux différents titres de séjour qui peuvent être
  délivrés aux étrangers en général et aux conditions de leur délivrance, ne
  sont pas applicables aux ressortissants algériens, lesquels relèvent à cet
  égard des règles fixées par l'accord précité."
  **A pass:** the words appear in that order, at point 3 of the decision
  (2e et 7e chambres réunies, 2 mars 2026, n° 500835). **Also confirm the case
  is still about a certificat de résidence "commerçant"** — the notice's own
  words say the judgment settles the principle and not the talent cards, and
  that limit is read off this case's subject.
  **A fail:** the decision has been superseded or the URL now serves a
  different one. Do not reword the notice to fit a new judgment; a decision
  that reaches the talent cards would SETTLE the open question, which is a
  finding to raise, not a quote to edit.

### Directive (EU) 2021/1883 — `notice:fr-dz-talent-open-question`

https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32021L1883

**What the refusal is, and is not** (session, 2026-09-10): both pages open in
a real browser — Legifrance renders the decision with its title *"Conseil
d'État, 2ème - 7ème chambres réunies, 02/03/2026, 500835"* and the sentence
quoted above is in the text; EUR-Lex renders 127 KB of the directive and
Article 3(1) is there verbatim, followed by the 3(2) exclusions. So the limit
is this watch's fetcher, not the page: a person can read both, and so can a
browser. The human tier is the honest label today; a browser-driven read for
bot-walled entries is a roadmap candidate, gated on one measurement — whether
*headless* Chrome from the runner is let through where Node's `fetch` is not.

- [x] **NEW with s8.** Read 2026-09-10. Backs the other side of the notice:
  the directive's own scope. Find Article 3(1) and confirm it word for word:
  "This Directive applies to third-country nationals who apply to be admitted,
  or who have been admitted, to the territory of a Member State for the purpose
  of highly qualified employment under this Directive."
  **A pass:** the sentence is Article 3(1) of the directive in its English
  edition, and Article 3(2)'s eight exclusions still name no class defined by a
  bilateral agreement with one Member State.
  **A fail:** an amending directive has narrowed the scope article. That is a
  rule change on every EU Blue Card route, not only this notice — record it and
  raise it.


s5e attached a source, a verbatim quote and a read date to every sentence a card
can render. **78 of those quotes are now machine-verified** on each `npm run
check`: the gate finds the sentence on the snapshot of the page it cites, or the
build fails. **Six are not**, and they are all on the same two PDFs. This file
is that list, and nothing else — it is short because the cost the scenario
priced in did not fall due: the German BAMF pages, the Spanish BOE and every
IND route page answer this host in full today, so their quotes went to the
machine tier instead (see "What did not need a human" below).

**Read section 5 before trusting section 4** (renumbered 2026-09-16; they were 4 and 3), and read section 3 before trusting either about the IND pages. The reassurance section 3 offered
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

## 3. Quotes that need a person — form-gated web tier (5 pages, 38 quotes — 30 distinct sentences), opened 2026-09-16

> **READ — 2026-09-16, the day the tier opened.** All five pages were opened
> in Chrome by the session, at the human's request (*"bunları chrome'u
> kullanarak kontrol edemiyor musun"*), the form answered as this section says
> (nationality Turkish, no valid permit, none expired under two years), every
> collapsed "Show details" section opened, and each sentence below searched
> for word for word in the rendered page. **26 of 26 distinct sentences found**
> (38 quotes), on every page. One false alarm on the way: the first search of
> the HSM page read only the visible text and reported the MVV sentence
> absent — it sits in a collapsed *1. Check requirements* block and is there
> word for word; the search was widened to the whole rendered tree before any
> page was called a fail. The page also carries a newer phrasing of the same
> fact above the fold (*"According to your answers, a provisional residence
> permit (in Dutch: MVV) is needed."*); the dataset keeps the sentence it
> quotes, which is still on the page. `last_verified` on the five entries is
> this day. Next read due 2026-12-15.

Every route page the IND publishes for the five Dutch routes this dataset
scores or quotes. On 2026-09-16 the watch's first green-fetching run since the
User-Agent repair found the highly-skilled-migrant page **changed** and the
other four **unreachable** (slice marker gone). Read the same day: each is a
Drupal form now — *"Your situation — We will first ask you a few questions"* —
and the requirement list is rendered after the form is answered. The human
answered it in a browser and the URL did not change (*"url sabit"*): the result
has no address of its own.

**Why a person.** Measured 2026-09-16 with this watch's own fetcher and again
with a browser User-Agent: both **HTTP 200**, both a ~700-character shell
between the page's lede and its footer — the intro, the form and the footer
menu, none of the quoted sentences (the whole page is ~1.4 kB of text, ~35 kB
of HTML). A shell that answers 200 is the case section 5 below describes: the
HSM entry, whose slice started at the page's own lede, hashed the shell as a
change, wrote it into `state.json` as the page, and the next `npm run check`
put all twelve HSM quotes into `missing`. The other four entries' slices
started at "Requirements", which the shell does not carry, so they reported
`unreachable` and kept their old snapshots — against which their quotes still
"verified". Four of the five had been in this state for some time: the page
dates below are the IND's own "Last update" and predate the form on three of
them, so they do not say when the form arrived. Nothing on the site changes
for a reader: every sentence stays as read, with its date. What changes is how
they are kept honest — a person, quarterly, where the machine cannot.

**How to reach the requirements.** Open the page. Under *Your situation* the
form asks, in this order: *What is your nationality?* — choose a non-EU
nationality (Türkiye, for one); *Do you already have a valid Dutch residence
permit?* — No; *Did you have a Dutch residence permit and did it expire less
than 2 years ago? And do you still live in the Netherlands?* — No. Then *View
information*. The requirement list renders below the form at the same URL. The
list is the one a first-time applicant from outside the EU sees; the sentences
below were read from that list on the dates given, when the page still carried
it without a form.

**The road back** is a headless-browser strategy that answers the form for the
watch (data #17). The one measurement it is gated on has been taken: headless
Chrome reads ind.nl. Until it exists, `last_verified` on each entry is the day
a person last read the list, and `max_age_days: 90` is the reminder.

**A pass:** the sentence appears in the rendered requirement list, word for
word. **A fail:** the sentence has moved or been reworded — that is a value
change with a history line on the value, not a checklist edit; do not reword
the dataset to fit from here. A sentence that has *disappeared* is the same:
record which, raise it.

### Highly skilled migrant — `nl-hsm-30plus`, `nl-hsm-under30`

https://ind.nl/en/residence-permits/work/highly-skilled-migrant

Page "Last update": 11 September 2026. 12 quotes. Six sentences, each quoted on
both routes. This is the page whose shell the run of 2026-09-16 wrote in as the
page; the twelve `missing` quotes of that run are these.

- [ ] `nl-hsm-30plus`, `nl-hsm-under30` — the `situation` criterion, read
      2026-09-07. Find this sentence and confirm it word for word: "You have an
      employment contract with an employer or research institution in the
      Netherlands. This employer is a sponsor recognised by the IND."
- [ ] `nl-hsm-30plus:salary-must-match-the-market-rate`,
      `nl-hsm-under30:salary-must-match-the-market-rate` — a precondition, read
      2026-09-07. Find this sentence and confirm it word for word: "The agreed
      salary is in line with the market rate."
- [ ] `nl-hsm-30plus:employer-must-be-a-recognised-sponsor`,
      `nl-hsm-under30:employer-must-be-a-recognised-sponsor` — a precondition,
      read 2026-09-07. Find this sentence and confirm it word for word: "This
      employer is a sponsor recognised by the IND. A recognised sponsor is
      listed in the public register of recognised sponsors."
- [ ] `nl-hsm-30plus:big-register-for-healthcare-professions`,
      `nl-hsm-under30:big-register-for-healthcare-professions` — a precondition,
      read 2026-09-07. Find this sentence and confirm it word for word: "Are you
      going to work in individual healthcare? And do you practise a medical
      profession that is listed in Article 3 and Article 36a of the Individual
      Healthcare Professions Act (BIG Act)? If so, you must be registered in the
      BIG register."
- [ ] `nl-hsm-30plus:a-contract-abroad-is-a-transfer`,
      `nl-hsm-under30:a-contract-abroad-is-a-transfer` — a caveat, read
      2026-09-08. Find this sentence and confirm it word for word: "Do you have
      an employment contract with a company located outside the EU? And are you
      going to be transferred as a manager, specialist or trainee? Then you are
      an intra corporate transferee and other requirements apply to you."
- [ ] `nl-hsm-30plus:mvv-needed`, `nl-hsm-under30:mvv-needed` — a precondition,
      read 2026-09-10. Find this sentence and confirm it word for word: "A valid
      provisional residence permit (MVV) is needed for this application"

### Orientation year — `nl-orientation-year`

https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year

Page "Last update": 16 September 2026. 8 quotes. The form asks for a nationality
first; the three study-programme limbs are alternatives in one list, so all
three must still be there.

- [ ] `nl-orientation-year` — the `any` criterion, read 2026-09-07. Find this
      sentence and confirm it word for word: "You completed one of the following
      study programmes in the 3 years before the date of application:"
- [ ] `nl-orientation-year` — the `nl_recent_grad` criterion, read 2026-09-07.
      Find this sentence and confirm it word for word: "An accredited bachelor’s
      or master’s degree programme at a Dutch higher education institution."
- [ ] `nl-orientation-year` — the `top200_grad` criterion, read 2026-09-07. Find
      this sentence and confirm it word for word: "A master’s degree programme,
      a doctoral programme or a post-master’s study programme at a designated
      foreign educational institution"
- [ ] `nl-orientation-year:no-second-orientation-year` — a precondition, read
      2026-09-07. Find this sentence and confirm it word for word: "You have not
      previously held a residence permit for an orientation year for the same
      research for which you are now applying. Nor have you held such a permit
      following the completion of the same study programme or doctoral
      programme."
- [ ] `nl-orientation-year:turkish-citizens-differ` — a caveat, read 2026-09-07.
      Find this sentence and confirm it word for word: "Different requirements
      may apply to Turkish citizens and their family members."
- [ ] `nl-orientation-year:the-research-finished-within-three-years` — a
      precondition, read 2026-09-07. Find this sentence and confirm it word for
      word: "You have conducted scientific research in the Netherlands in the 3
      years before the date of application."
- [ ] `nl-orientation-year:english-where-the-institution-was-abroad` — a
      precondition, read 2026-09-07. Find this sentence and confirm it word for
      word: "If you have completed your course or programme at a designated
      foreign educational institution, you must also meet one of the following
      requirements: You obtained a minimum score of 6.0 on a test in the
      International English Language Testing System (IELTS)."
- [ ] `nl-orientation-year:mvv-needed` — a precondition, read 2026-09-10. Find
      this sentence and confirm it word for word: "A valid provisional residence
      permit (MVV) is needed for this application"

### European Blue Card — `nl-blue-card`

https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit

Page "Last update": 15 June 2026. 7 quotes. One sentence is quoted twice — as
the `situation` criterion and as a precondition.

- [ ] `nl-blue-card`, `nl-blue-card:employment-contract-valid-for-six-months` —
      the `situation` criterion / a precondition, read 2026-09-07. Find this
      sentence and confirm it word for word: "Your employment contract is valid
      for at least 6 months."
- [ ] `nl-blue-card` — the `any` criterion, read 2026-09-07. Find this sentence
      and confirm it word for word: "you have a diploma of a programme in higher
      education. This programme was at least 3 years."
- [ ] `nl-blue-card` — the `experience` criterion, read 2026-09-07. Find this
      sentence and confirm it word for word: "you have a minimum of 5 years of
      relevant work experience"
- [ ] `nl-blue-card` — the `experience_7y` criterion, read 2026-09-07. Find this
      sentence and confirm it word for word: "Are you an IT manager or IT
      professional? A minimum of 3 years of relevant work experience is required
      during the period of 7 years before the application."
- [ ] `nl-blue-card:permission-to-practise-a-regulated-profession` — a
      precondition, read 2026-09-07. Find this sentence and confirm it word for
      word: "Do you have a regulated profession, such as doctor or lawyer? Then
      you must demonstrate that you are allowed to practice this profession in
      the Netherlands. Are you going to work in individual healthcare? And do
      you practise a medical profession that is listed in Article 3 and Article
      36a of the Individual Healthcare Professions Act (BIG Act)? If so, you
      must be registered in the BIG register."
- [ ] `nl-blue-card:mvv-needed` — a precondition, read 2026-09-10. Find this
      sentence and confirm it word for word: "A valid provisional residence
      permit (MVV) is needed for this application"

### Intra-corporate transferee (Directive 2014/66/EU) — `nl-ict`

https://ind.nl/en/residence-permits/work/intra-corporate-transferee-residence-permit-directive-201466eu

Page "Last update": 15 June 2026. 6 quotes. One sentence is quoted twice — as
the `situation` criterion and as a precondition.

- [ ] `nl-ict`, `nl-ict:three-months-with-the-company-outside-the-union` — the
      `situation` criterion / a precondition, read 2026-09-07. Find this
      sentence and confirm it word for word: "You have already worked for the
      company outside the EU, EEA or Switzerland for at least 3 months."
- [ ] `nl-ict` — the `any` criterion, read 2026-09-07. Find this sentence and
      confirm it word for word: "Your salary is in line with the market. The
      salary is in line with the market if it meets the salary criterion for
      highly skilled migrants."
- [ ] `nl-ict:a-manager-specialist-or-trainee-post` — a precondition, read
      2026-09-07. Find this sentence and confirm it word for word: "You are
      going to work in the Netherlands as a manager, specialist or trainee."
- [ ] `nl-ict:permission-to-practise-a-protected-profession` — a precondition,
      read 2026-09-07. Find this sentence and confirm it word for word: "Do you
      have a protected profession such as a doctor or architect? If so, you must
      show that you are allowed to practise that profession in the Netherlands."
- [ ] `nl-ict:mvv-needed` — a precondition, read 2026-09-10. Find this sentence
      and confirm it word for word: "A valid provisional residence permit (MVV)
      is needed for this application"

### Researcher (Directive (EU) 2016/801) — `nl-researcher`

https://ind.nl/en/residence-permits/work/residence-permit-researcher-directive-eu-2016801

Page "Last update": 18 August 2026. 5 quotes.

- [ ] `nl-researcher` — the `situation` criterion, read 2026-09-07. Find this
      sentence and confirm it word for word: "You have an employment contract or
      a host agreement with your employer"
- [ ] `nl-researcher:other-income-can-meet-this` — a caveat, read 2026-09-07.
      Find this sentence and confirm it word for word: "Will you not receive a
      salary from your Dutch employer? Then you must have other income, for
      example a grant, stipend or money from a sponsor. Or you have sufficient
      money in your bank account for the time you are in the Netherlands."
- [ ] `nl-researcher:the-institute-must-be-a-recognised-sponsor` — a
      precondition, read 2026-09-07. Find this sentence and confirm it word for
      word: "This research institute (hereinafter referred to as: employer) is a
      recognised sponsor. You can check the public register of recognised
      sponsors whether your employer has been recognised as a sponsor."
- [ ] `nl-researcher:a-degree-that-opens-a-doctorate` — a precondition, read
      2026-09-07. Find this sentence and confirm it word for word: "You have a
      higher education degree. This degree gives you access to the doctoral
      programme. Your employer determines whether your degree is suitable. Do
      you not have a suitable degree? Then your employer must declare that you
      have the appropriate level."
- [ ] `nl-researcher:mvv-needed` — a precondition, read 2026-09-10. Find this
      sentence and confirm it word for word: "A valid provisional residence
      permit (MVV) is needed for this application"

## 4. What did not need a human

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

## 5. Correction (2026-09-07, review): the shell is still there, and the gate was pointed the wrong way

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
