# s5c human verification checklist — reduced thresholds · passport classes · FR talent

Curated 2026-09-04. Everything below entered the dataset (or `countries.json`)
with quote + source + date, cut out of a watched snapshot or a live fetch.
Real-green requires a human pass: open the URL, find the quote, tick the box.
Any mismatch → fix the value, re-run `npm run check`, note it in DECISIONS.

## Netherlands — ind.nl (machine-watched, quote fidelity green)

- [x] Required amounts page, table row: "Highly skilled migrants reduced salary
      criterion **€ 3,122.00**"
      https://ind.nl/en/required-amounts-income-requirements
- [x] Same page: "Reduced salary criterion European Blue Card **€ 4,754.00**"
- [x] Same page: the three qualifying cases quoted in the HSM reduced path's note
      (orientation-year permit held or applied under; or within 3 years of the
      graduation date, doctoral defence, or a research permit expiring)
- [x] Same page: "The reduced EU Blue Card salary criterion applies to graduates
      who have completed a higher education programme."
- [x] Confirm the page states **no** reduced criterion for the intra-corporate
      transferee permit — `nl-ict` keeps the full amounts and says so in its summary

## Spain — UGE threshold PDF (human tier: no text snapshot exists)

- [x] "**– Umbral reducido: 33.085,09 €**" — the reduced Blue Card threshold now
      shipping on `es-blue-card`
      https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf
      (byte-hash in watch state: 3a577351…053f4609 — confirm the PDF is "Junio 2026")
- [x] The Orden's two limbs: confirm only the qualification-within-3-years limb is
      modelled and the CNO-2011 groups 1–2 limb reads as a precondition on the card
- **Known gap:** this is the one s5c value the quote-fidelity gate cannot verify.
  `npm run watch:coverage` reports it as `unverifiable — pdf tier`, never as verified.

## France — service-public.gouv.fr F16922 (machine-watched)

- [x] entreprise innovante: « Être recruté dans une jeune entreprise innovante ou
      une entreprise reconnue innovante par le ministère de l'économie »
      https://www.service-public.gouv.fr/particuliers/vosdroits/F16922
- [x] entreprise innovante: « Avoir un contrat de travail qui prévoit une
      rémunération brute annuelle supérieure ou égale à **39 582 €** »
- [x] salarié en mission: « Avoir un contrat de travail avec l'entreprise qui vous
      emploie en France » and « Percevoir une rémunération brute annuelle
      supérieure ou égale à **39 582 €** »
- [x] salarié en mission: « Avoir une ancienneté d'au moins 3 mois dans le groupe
      qui vous emploie » — shipped as a precondition, not a scored criterion

## Türkiye notice — europa.eu (machine-watched)

- [x] "As a national of Türkiye, your rights to live and work in an EU country
      depend entirely on the national rules of that country. …" through
      "…after four years' legal employment you enjoy full access to any paid
      employment in that EU country."
      https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm

## The passport classes — `data/countries.json`

`classes.eu_eea_ch.members` is a rule: it decides who needs a permit at all. It
carries one source per leg, and all three are machine-watched value sources
whose quotes the fidelity gate checks.

- [x] **EU-27, page 1 (20 states)** — https://european-union.europa.eu/principles-countries-history/eu-countries_en
      The quote is the page's own membership list ("Showing results 1 to 20
      Austria EU Member State since 1995 … Netherlands …"). Check the twenty
      names are there and that each says **EU Member State since**.
- [x] **EU-27, page 2 (7 states)** — https://european-union.europa.eu/principles-countries-history/eu-countries_en?page=1
      Poland, Portugal, Romania, Slovakia, Slovenia, Spain, Sweden — same
      wording. (Page 2 used to be a bare hash; the review promoted it to a
      quoted value source, because seven members were resting on nothing a
      reader could check.)
- [x] **EEA (Iceland, Liechtenstein, Norway)** — https://www.efta.int/eea
      "The Agreement on the European Economic Area, which entered into force on
      1 January 1994, brings together the EU Member States and the three EEA EFTA
      States — Iceland, Liechtenstein and Norway — … the four freedoms — the free
      movement of goods, services, persons and capital — throughout the 30 EEA
      States."
      **Judgement to confirm:** EFTA is the secretariat of the EEA EFTA States and
      publishes the EEA legal texts, so this is taken as official. No europa.eu
      page that a plain fetch can read was found stating the EEA membership *and*
      free movement of persons in one place; the Your Europe work-permits page
      names Norway and Iceland only inside a Liechtenstein quota warning.
- [x] **Switzerland** — https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm
      "Under the EU-Switzerland agreement on the free movement of persons, Swiss
      nationals are free to live and work in the EU."

### How the country list itself was built

`countries` is a vocabulary, not a rule, so it carries no provenance. It is
**199 passport issuers**: sovereign states plus the widely-held non-UN documents
(Hong Kong, Macao, Taiwan, Kosovo, Palestinian Territories). Dependent
territories are deliberately absent — a resident of Åland holds a Finnish
passport, of Guadeloupe a French one, and listing the territory made the tool
answer "third country" to people who have free movement (found in the s5c
review). The list started from CLDR's region names and was cut down; a
regression test asserts no dependent territory is reachable.

**Answered 2026-09-06: hand-edit them.** Twelve labels were rewritten to
ordinary English usage — the CLDR forms abbreviated ("St. Kitts & Nevis"),
punctuated oddly ("Congo - Kinshasa") and disambiguated in ways no passport
does ("Hong Kong SAR China"). Every displaced form is kept as an alias, and a
test now fails if a label carries an abbreviation or a localisation artefact
again. Doing it surfaced a live search defect: folding ignored diacritics but
not punctuation, so "cote d'ivoire" typed with a straight apostrophe matched
nothing. Folding now drops punctuation entirely.

- [ ] Read the twelve new labels in the live control and say they look right:
      Antigua and Barbuda · Bosnia and Herzegovina · Democratic Republic of the
      Congo · Republic of the Congo · Hong Kong · Macao · Myanmar · Saint Kitts
      and Nevis · Saint Lucia · Saint Vincent and the Grenadines · São Tomé and
      Príncipe · Trinidad and Tobago
- [ ] While you are there, the rest of the spot-check: "Türkiye", "Czechia",
      "Eswatini", "North Macedonia", "Côte d'Ivoire", "Kosovo" — and typing the
      old name still finds each of them.
