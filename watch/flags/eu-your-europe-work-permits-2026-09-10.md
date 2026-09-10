# Watch flag: eu-your-europe-work-permits — changed
- url: https://europa.eu/youreurope/citizens/work/work-abroad/work-permits/index_en.htm
- kind: value-source
- date: 2026-09-10
- old: 031507390725b706bfd9fcd04ce453f4d954e97d1ac097cb4a2bb585b501a367
- new: 14305ee826fbbdecb7d01223a7742b4cd5243dccb577f5012a48440b5d8506b4

Intent: Backs the eu-free-movement notice (EU nationals need no work permit). Your Europe restates the TFEU art. 45 position; a change here changes what the tool tells every EU passport holder.

> …As an EU national you generally don't need a work permit to work anywhere in the EU . Work permits are never required fo…
Update the dataset value(s) with quote + retrieval date; move the old value into history.

## Resolved — 2026-09-10 (read by the session)

False alarm: the page's own words did not move. The entry hashed the whole
page, navigation included, and two submenu items under "Package travel and
timeshare" swapped places — the old and new texts are the same length and the
same words, and the divergence is at character 1,549, inside the site menu,
nowhere near a work permit.

Fixed the way the buzer statutes were fixed on 2026-09-08: the entry is now
sliced to the region this dataset actually reads — from the sentence it quotes
("As an EU national you generally don't need a work permit…") through the
Türkiye section and the list of countries with EU agreements, to the end of
"…depends on the national laws of that country." 15,757 characters watched
became 2,361. Anything a change to would change what this product says is
inside the bound; the menu is outside it.

Re-baselined in the same commit, per the rule that exists because we once did
not: `npm run watch:sources -- --only=eu-your-europe-work-permits --commit`.
Quote fidelity re-run: 137 verified, none missing.
