# s5 human verification checklist — FR · ES · NL (curated 2026-09-02)

Agent-curated values below entered the dataset with quote+source+date. Real-green
requires a human pass over each source (VPN where needed): open the URL, find the
quote, tick the box. Any mismatch → fix dataset + note in DECISIONS.

## France — service-public.gouv.fr (no VPN needed; fetched clean)

- [ ] F16922 (talent): « …rémunération brute annuelle supérieure ou égale à **39 582 €** » — salarié qualifié accordion
      https://www.service-public.gouv.fr/particuliers/vosdroits/F16922
- [ ] F16922 (talent): « …1,5 fois le salaire brut moyen annuel de référence, soit **59 373,00 € brut annuel** » — carte bleue européenne accordion
- [ ] F16922: salarié qualifié requires the degree **obtained in France** (master / Grandes Écoles niveau 1) — confirms the `fr_degree` gate
- [ ] F33952 (ICT): « Justificatif de ressources supérieures ou égales à **1 867,02 € brut par mois** »
      https://www.service-public.gouv.fr/particuliers/vosdroits/F33952
- [ ] Confirm nothing on F16922 gives a per-subtype threshold for « entreprise innovante » / « salarié en mission » (kept excluded — exclusions.md)

## Spain — BOE + UGE (PDF needs a human read per project policy)

- [ ] UGE threshold PDF (June 2026): "Umbral general: **41.356,36 €**" and "Umbral reducido: 33.085,09 €" (reduced not modeled)
      https://www.inclusion.gob.es/documents/d/unidadgrandesempresas/umbral-salarial.pdf
      (byte-hash in watch state: 3a577351…f543f609 — confirm the PDF you read matches "Junio 2026")
- [ ] Same PDF: "PAC nacional … umbral único de **41.356,36 €** – No se aplica umbral reducido"
- [ ] Ley 14/2013 art. 71 bis.1.b (BOE consolidated): contract/offer "de al menos seis meses"
      https://www.boe.es/buscar/act.php?id=BOE-A-2013-10074
- [ ] Ley 14/2013 art. 73.2.c (ICT): prior group employment "de 3 meses"
- [ ] Ley 14/2013 art. 72 (researcher): hosting agreement / contract categories as summarized
- [ ] Golden visa really gone: arts. 63–67 show "(Sin contenido)" from 03-04-2025

## Netherlands — ind.nl (English pages; fetched clean)

- [ ] Required amounts page: "Highly skilled migrants 30 years or older | **€5,942.00**"
      https://ind.nl/en/required-amounts-income-requirements
- [ ] Same page: "Highly skilled migrants younger than 30 years | **€4,357.00**"
- [ ] Same page: "European Blue Card | **€5,942.00**"
- [ ] Same page, researcher section: **€1,635.90** gross SV/month without holiday allowance, window "1 July – 31 December 2026" — the dataset quote is the bare amount; capture the full row wording and update the quote
- [ ] HSM page: employer must be an IND-**recognised sponsor**; market-rate salary test wording
      https://ind.nl/en/residence-permits/work/highly-skilled-migrant
- [ ] Blue Card page: 6-month contract; sponsor recognition NOT required; 3-year diploma OR 5 years experience
      https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit
- [ ] ICT page: 3+ months with the company outside EU; salary "meets the salary criterion for highly skilled migrants"
      https://ind.nl/en/residence-permits/work/intra-corporate-transferee-residence-permit-directive-201466eu
- [ ] Orientation year page: 3-year window; top-200 in 2 of 3 ranking publishers (THE / QS / ShanghaiRanking) — verify the 2-of-3 mechanic verbatim
      https://ind.nl/en/residence-permits/work/residence-permit-for-orientation-year

## On mismatch

Fix the value/quote in `data/dataset.json` (move the old value into `history`),
re-run `npm run check`, and record the catch in the navigator's DECISIONS.md.
