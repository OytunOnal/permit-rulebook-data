# s5c human verification checklist — reduced thresholds · passport classes · FR talent

Curated 2026-09-04. Everything below entered the dataset (or `countries.json`)
with quote + source + date, cut out of a watched snapshot or a live fetch.
Real-green requires a human pass: open the URL, find the quote, tick the box.
Any mismatch → fix the value, re-run `npm run check`, note it in DECISIONS.

## Netherlands — ind.nl (machine-watched, quote fidelity green)

- [ ] Required amounts page, table row: "Highly skilled migrants reduced salary
      criterion **€ 3,122.00**"
      https://ind.nl/en/required-amounts-income-requirements
- [ ] Same page: "Reduced salary criterion European Blue Card **€ 4,754.00**"
- [ ] Same page: the three qualifying cases quoted in the HSM reduced path's note
      (orientation-year permit held or applied under; or within 3 years of the
      graduation date, doctoral defence, or a research permit expiring)
- [ ] Same page: "The reduced EU Blue Card salary criterion applies to graduates
      who have completed a higher education programme."
- [ ] Confirm the page states **no** reduced criterion for the intra-corporate
      transferee permit — `nl-ict` keeps the full amounts and says so in its summary

## Spain — UGE threshold PDF (human tier: no text snapshot exists)

- [ ] "**– Umbral reducido: 33.085,09 €**" — the reduced Blue Card threshold now
      shipping on `es-blue-card`
      https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf
      (byte-hash in watch state: 3a577351…053f4609 — confirm the PDF is "Junio 2026")
- [ ] The Orden's two limbs: confirm only the qualification-within-3-years limb is
      modelled and the CNO-2011 groups 1–2 limb reads as a precondition on the card
- **Known gap:** this is the one s5c value the quote-fidelity gate cannot verify.
  `npm run watch:coverage` reports it as `unverifiable — pdf tier`, never as verified.

## France — service-public.gouv.fr F16922 (machine-watched)

- [ ] entreprise innovante: « Être recruté dans une jeune entreprise innovante ou
      une entreprise reconnue innovante par le ministère de l'économie »
      https://www.service-public.gouv.fr/particuliers/vosdroits/F16922
- [ ] entreprise innovante: « Avoir un contrat de travail qui prévoit une
      rémunération brute annuelle supérieure ou égale à **39 582 €** »
- [ ] salarié en mission: « Avoir un contrat de travail avec l'entreprise qui vous
      emploie en France » and « Percevoir une rémunération brute annuelle
      supérieure ou égale à **39 582 €** »
- [ ] salarié en mission: « Avoir une ancienneté d'au moins 3 mois dans le groupe
      qui vous emploie » — shipped as a precondition, not a scored criterion

## Türkiye notice — europa.eu (machine-watched)

- [ ] "As a national of Türkiye, your rights to live and work in an EU country
      depend entirely on the national rules of that country. …" through
      "…after four years' legal employment you enjoy full access to any paid
      employment in that EU country."
      https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm

## The passport classes — `data/countries.json`

`classes.eu_eea_ch.members` is a rule: it decides who needs a permit at all. It
carries one source per leg, and all three are machine-watched value sources
whose quotes the fidelity gate checks.

- [ ] **EU-27** — https://european-union.europa.eu/principles-countries-history/eu-countries_en
      "Click on the map and filters below to explore the countries of the
      European Union. …"
      **Caveat to check by eye:** the page paginates at 20 of 27. The quote is the
      framing sentence, and the watched slice carries the first 20 names plus the
      "Pages (27)" count. The remaining seven (Poland, Portugal, Romania,
      Slovakia, Slovenia, Spain, Sweden) live on page 2, watched as the sentinel
      `eu-countries-list-page2` — a hash, with no quote of its own.
- [ ] **EEA (Iceland, Liechtenstein, Norway)** — https://www.efta.int/eea
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
- [ ] **Switzerland** — https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm
      "Under the EU-Switzerland agreement on the free movement of persons, Swiss
      nationals are free to live and work in the EU."

### How the country list itself was built

`countries` is a vocabulary, not a rule, so it carries no provenance. It was
generated, not typed: every two-letter region CLDR knows (via
`Intl.DisplayNames(["en"], { type: "region" })`), minus the codes ISO 3166-1
does not officially assign — 15 withdrawn transitional reservations
(AN BU CS DD DY FX HV NH RH SU TP VD YD YU ZR) and 16 exceptionally reserved,
user-assigned or CLDR-only codes (AC CP CQ DG EA EU EZ IC QO TA UK UN XA XB XK
ZZ). The generator asserts the result is exactly **249**, the count of officially
assigned alpha-2 codes, and that every class member is in the list.

- [ ] Spot-check the names read as English usage: "Türkiye" (not Turkey),
      "Czechia", "Eswatini", "North Macedonia", "Côte d'Ivoire".
- [ ] Known wart: CLDR writes "Congo - Kinshasa" / "Congo - Brazzaville" and
      "Hong Kong SAR China". Left as the standard English localisation rather
      than hand-edited — decide whether to override before v1.
- [ ] Known wart: ISO 3166-1 includes uninhabited territories (Antarctica,
      Bouvet Island, Heard & McDonald Islands) that issue no passport. The spec
      asked for the full list; decide before v1 whether to filter.
