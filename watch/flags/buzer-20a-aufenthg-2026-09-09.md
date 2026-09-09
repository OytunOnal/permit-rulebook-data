# Watch flag: buzer-20a-aufenthg — changed
- url: https://www.buzer.de/20a_AufenthG.htm
- kind: value-source
- date: 2026-09-09
- old: 91e1f3f94203e43da39ca7bfa912689ccac80b421feb92b9fb5d7621edcda74b
- new: fb30caafdad5a0a78ca05030edb9557d02654eedfc82816ee7019081ddfb105c

Intent: § 20a AufenthG — the Opportunity Card's own statute. Backs the caveat that the card allows at most 20 hours of work a week, and is the read that settled that no condition of the card requires the applicant to have no job offer (human read 2026-09-07). Official-source re-check tracked by the gesetze human-tier entry.

> …(1) Eine Chancenkarte ist eine Aufenthaltserlaubnis zur Suche nach einer Erwerbstätigkeit oder nach Maßnahmen zur Anerke…
Update the dataset value(s) with quote + retrieval date; move the old value into history.

## Resolved — 2026-09-09 (read by the session)

False alarm, and ours: nothing on the page moved. The entry's slice was bound
to the statute body on 2026-09-08 (commit `3030847`, 31,517 → 4,476
characters) and its baseline was never re-read, so this run — the first after
that commit — hashed a different region and called our own edit a change.

Verified before writing this: today's sliced text is a **substring of
yesterday's**, character for character, for all three buzer entries; and the
whole suite is green, quote fidelity included, so every sentence this dataset
ships from this page is still on it verbatim. No value moved, and none is
edited.

Fixed so it cannot recur: a snapshot now records the slice it was read through
(`slice_read`), and `npm test` refuses a shipped state whose fingerprint is
not the slice the watchlist names today — a commit that moves a marker must
re-read that entry in the same commit (CONTRIBUTING, "Moving a slice re-reads
its baseline"). The header above stays as the run recorded it.
