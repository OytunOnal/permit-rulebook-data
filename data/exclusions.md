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
| EU Blue Card — reduced threshold, shortage-occupation limb | **Partly modelled in s5c; sourced 2026-09-07.** The qualification-within-3-years limb ships on `es-blue-card` as a second salary path (€33,085.09). The CNO-2011 groups 1–2 limb stays out of the scoring — the SEPE catalogue URL is still unverified — and is stated on the card as a caveat, which since 2026-09-07 carries the UGE PDF's own wording of both limbs (`reduced-also-for-shortage-occupations`). One thing to note while it stays out: the PDF is narrower than the caveat's plain English. It offers the reduced threshold to "Ocupaciones de difícil cobertura incluidas en los grupos 1 y 2 de la CNO-2011", i.e. within the CNO's managerial and professional groups, where the caveat says only "Spain's official list of shortage occupations". The quote sits beside the sentence on the card, so a reader sees both; tightening the sentence is a candidate edit, not a verdict change (nothing scores off it). |
| EU Blue Card — whether the reduced threshold carries an institution restriction (2026-09-07) | **Settled 2026-09-07 — by reading the PDF, not by guessing.** s5d replaced the country-less `qualification_recent` gate on the three Dutch routes because the IND's own text puts an institution restriction behind it, and this row stood open because the Spanish source was assumed unreadable. It is not: the UGE salary PDF (edición Junio 2026) carries a text layer, and it states the limb — "Personas nacionales de terceros países que hayan obtenido la cualificación requerida en los tres años previos a la solicitud de la Tarjeta Azul-UE" — naming a qualification, a three-year window and no institution anywhere. `es-blue-card` therefore keeps `qualification_recent` unchanged: the wording backs what was already modelled rather than changing it, so no verdict moves. The card tells the reader as much in its own words, in the reading `salary-figures-and-their-limits-read-by-a-person`. The criterion carried an unsourced `note` saying the same thing until 2026-09-07, when `note` was removed as the one renderable slot that declared no kind (review). What is still unread is Orden PJC/44/2026 itself, which the ministry does publish as a scanned image; the PDF above is a restatement of it by the same ministry, not the Orden. |
| Digital nomad (arts. 74 bis–quinquies) | Employment-based but needs a new "remote employer elsewhere" situation, and the euro floor (€2,442/month) is arithmetic (200% × SMI) — no verbatim official euro figure exists to quote. Backlog: model once a quotable figure or formula-provenance support lands. |
| Entrepreneur (arts. 69–70) | Qualitative ENISA report — discretionary; also self-employment. |
| Self-employed general regime / seasonal / audiovisual / students / family members | Not employment-based residence routes, or quota/derivative schemes. |

## Netherlands (NL)

| Route | Reason |
|---|---|
| Self-employed person | RVO points-scoring of a business plan (30/30/30 or 45/45) — discretionary. |
| Essential start-up personnel (pilot) | Innovativeness test is discretionary and the pilot sunsets 2028-06-01. Deterministic parts (€3,122 salary, 1% equity) noted for a possible later pass. |
| Single Permit (GVVA) / paid employment | UWV labour-market test — discretionary. |
| ~~HSM / Blue Card reduced criteria (€3,122 / €4,754)~~ | **No longer excluded — modelled in s5c** as second paths on the salary criteria of `nl-hsm-30plus`, `nl-hsm-under30` and `nl-blue-card`. **Corrected in s5d (2026-09-07):** the gate was `qualification_recent`, which asks no country — see the row below. Not modelled for `nl-ict`: IND restates the HSM amounts there but states no reduced criterion for that permit. |
| Reduced salary criterion — the two orientation year permit limbs (2026-09-07) | The IND states three cases. The third — "applied for within 3 years of the graduation date or date of the doctoral defence ceremony… or within 3 years of the date on which the residence permit for research expired" — additionally requires the applicant to meet the requirements for that residence purpose, the orientation year, which is where the institution restriction lives; that case ships on `nl-hsm-30plus`, `nl-hsm-under30` and `nl-blue-card` as an `any` over `nl_recent_grad` / `top200_grad`. The first two cases — holding an orientation year permit, or having held one — are **excluded**: the interview never asks about permits the applicant already holds or has held, so neither is computable from declared facts. Both are stated in each route's preconditions rather than left silent. |
| Orientation year (`nl-orientation-year`) — the Erasmus Mundus limb (2026-09-07) | The IND lists five qualifying situations; one is “You obtained a master's degree in the 3 years before the date of application in the context of an Erasmus Mundus Joint Master programme.” Not modelled: it needs a fact the interview does not ask (which programme a master's belonged to), and it is not implied by either fact we do ask. A person on this limb sees the route as not-yet rather than met. |
| Orientation year (`nl-orientation-year`) — the scientific-research limb's own conditions (2026-09-07) | The research limb is not “did research in the Netherlands”: the IND requires a prior Dutch residence permit for research under Directive (EU) 2016/801, or a highly skilled migrant permit based on scientific research, and a contract or appointment letter carrying a University Job Classification (UFO) job code that “starts with 01”. Not modelled: permits already held are never asked (see the row above on the reduced salary criterion), and no one can be expected to declare a UFO code. `nl_recent_grad` treats Dutch research as one broad case and is therefore wider than the source. |
| Orientation year (`nl-orientation-year`) — the finer Dutch-programme limbs (2026-09-07) | Under “completed one of the following study programmes” the IND lists an accredited Dutch bachelor's or master's; a Dutch post-master's programme of “at least one academic year (at least 10 months)”; a programme under the Cultural Policy (Special-Purpose Funding) Act; and a programme under the development cooperation policy of the Dutch Ministry of Foreign Affairs. Not modelled separately: each needs a fact about the programme's legal basis or length that a person cannot reliably declare. |
| Orientation year (`nl-orientation-year`) — what the two fields we ask really are (2026-09-07) | `nl_recent_grad` and `top200_grad` are a **simplification of a five-limb rule**, not a restatement of it. Between them they cover the accredited-Dutch-programme limb and the designated-foreign-institution limb, and they approximate the research limb; the Erasmus Mundus limb and the finer Dutch-programme limbs are outside them, and neither field checks the conditions the source attaches to its own limbs. The route's summary says so on the card, and its preconditions carry what the interview cannot ask. |
| Orientation year (`nl-orientation-year`) — whether Turkish citizens face different requirements (2026-09-07) | The IND ends the requirement list with “Different requirements may apply to Turkish citizens and their family members” and does not say what they are. Not modelled and not guessed at: it ships as a route statement, quoted, so a Turkish reader is not handed a flat answer the source itself qualifies. |
| Seasonal work, seafarers, interns, EU-programme work experience, cross-border variants, researcher short-term mobility, International Trade Regulation | Quota, niche, training or derivative schemes — not standard employment-based residence routes. |
| Recognition as sponsor · Employing a foreign national | Employer-side processes listed under IND's Work menu, not residence routes a person can hold. Sponsor recognition is a precondition on the HSM and researcher routes, stated on those cards. |

## The twin a machine reads

Everything above is prose for a person. This block is the same facts in a shape
a test can read, and the two are held to each other: the route ids here must be
exactly the route ids the prose above names in backticks, and every limb id here
must be a statement or a reading the route actually carries and must appear in
that route's `scope.not_asked`. If the prose and this block disagree the build
fails, rather than letting a page name limbs nobody recorded.

One line per route this file records: the route id, then the dataset ids of the
limbs it records as left out or stated-but-not-asked. `(none)` is a real answer
— it means the file records this route in order to say that nothing of it is
excluded.

```exclusions
es-blue-card: reduced-also-for-shortage-occupations, lower-salary-applied-with-no-institution-limit, it-professionals-limb-not-modelled
fr-talent-innovante: work-tied-to-the-research-and-development-project, a-young-innovative-company-or-one-the-ministry-recognises
fr-talent-mission: three-months-with-the-group-already, a-move-inside-one-company-or-group
nl-blue-card: reduced-also-on-extension-or-employer-change
nl-hsm-30plus: reduced-also-for-orientation-year-permit-holders
nl-hsm-under30: reduced-also-for-orientation-year-permit-holders
nl-ict: (none)
nl-orientation-year: two-of-five-situations-modelled, turkish-citizens-differ
```
