# Excluded routes — and why

The dataset only models routes whose outcome a person can compute from facts they
can declare about themselves. Routes below were researched (2026-09-02 curation
pass) and deliberately left out. Each entry names the reason; "discretionary"
means an authority weighs evidence rather than checking declarable criteria.

## Germany (DE)

| Route | Reason |
|---|---|
| IT specialists (§ 19c Abs. 2 without qualification) | Covered by the modeled experienced-worker route (§ 6 BeschV IT path). |
| Western Balkans regulation (§ 26 Abs. 2 BeschV) | Nationality-restricted quota scheme with labour-agency discretion. |
| Freelance / self-employment (§ 21) | Business-plan viability assessment — discretionary. |

## France (FR)

| Route | Reason |
|---|---|
| Carte « salarié » / « travailleur temporaire » (F15898) | The card is mechanical, but the prerequisite autorisation de travail embeds an opposable labour-market test plus employer-side compliance checks — not computable from applicant facts. |
| ~~Talent — entreprise innovante / salarié en mission~~ | **No longer excluded — modelled in s5c** as `fr-talent-innovante` and `fr-talent-mission`. The qualifier each subtype needed is now a declarable fact: `fr_innovative_employer` and `fr_local_contract`. Both carry the F16922 threshold (€39,582) with its own quote; the R&D link, the ministry recognition and the 3-month group seniority ship as preconditions, not as scored criteria. |
| Talent — professions médicales et de la pharmacie | Salary floor is fixed (€41,386.48) but eligibility hinges on an upstream health-code exercise authorization — a separate administrative act. |
| Talent — artistic professions / national renown / porteur de projet / mandataire social | Portfolio, reputation, business-plan or corporate-officer assessments — discretionary or not employment-based. |
| Talent — chercheur | The gate is the hosting agreement (convention d'accueil), like the modeled DE/ES/NL researcher routes — but France's fiche adds a master's-degree gate and no salary rule; candidate for a later modeling pass. |
| Travailleur saisonnier | Seasonal, ≤ 6 months/year, labour-market-tested. |

## Spain (ES)

| Route | Reason |
|---|---|
| Investor "golden visa" (Ley 14/2013 arts. 63–67) | Abolished — BOE: "(Sin contenido)… con efectos de 3 de abril de 2025" (LO 1/2025). |
| General regime cuenta ajena (RD 1155/2024 arts. 72–81) | Labour-market test (situación nacional de empleo): the catalogue path is deterministic but quarterly and provincial; the non-catalogue path is evaluative. Candidate for a later pass once the SEPE catalogue URL is verified. |
| EU Blue Card — reduced threshold, shortage-occupation limb | **Partly modelled in s5c.** The qualification-within-3-years limb ships on `es-blue-card` as a second salary path (€33,085.09). The CNO-2011 groups 1–2 limb stays out — the SEPE catalogue URL is still unverified — and is stated on the card as a precondition, not scored. |
| Digital nomad (arts. 74 bis–quinquies) | Employment-based but needs a new "remote employer elsewhere" situation, and the euro floor (€2,442/month) is arithmetic (200% × SMI) — no verbatim official euro figure exists to quote. Backlog: model once a quotable figure or formula-provenance support lands. |
| Entrepreneur (arts. 69–70) | Qualitative ENISA report — discretionary; also self-employment. |
| Self-employed general regime / seasonal / audiovisual / students / family members | Not employment-based residence routes, or quota/derivative schemes. |

## Netherlands (NL)

| Route | Reason |
|---|---|
| Self-employed person | RVO points-scoring of a business plan (30/30/30 or 45/45) — discretionary. |
| Essential start-up personnel (pilot) | Innovativeness test is discretionary and the pilot sunsets 2028-06-01. Deterministic parts (€3,122 salary, 1% equity) noted for a possible later pass. |
| Single Permit (GVVA) / paid employment | UWV labour-market test — discretionary. |
| ~~HSM / Blue Card reduced criteria (€3,122 / €4,754)~~ | **No longer excluded — modelled in s5c** as second paths on the salary criteria of `nl-hsm-30plus`, `nl-hsm-under30` and `nl-blue-card`, gated on `qualification_recent`. Not modelled for `nl-ict`: IND restates the HSM amounts there but states no reduced criterion for that permit. |
| Seasonal work, seafarers, interns, EU-programme work experience, cross-border variants, researcher short-term mobility, International Trade Regulation | Quota, niche, training or derivative schemes — not standard employment-based residence routes. |
| Recognition as sponsor · Employing a foreign national | Employer-side processes listed under IND's Work menu, not residence routes a person can hold. Sponsor recognition is a precondition on the HSM and researcher routes, stated on those cards. |
