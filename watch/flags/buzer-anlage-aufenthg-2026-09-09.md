# Watch flag: buzer-anlage-aufenthg — changed
- url: https://www.buzer.de/Anlage_AufenthG.htm
- kind: value-source
- date: 2026-09-09
- old: c7a4e8dca549d4f6924c6b39aa98dfe0e527a9b2980291771331cc8975bf84d7
- new: 59bd1fd0b986fa5e8e4d5e8ce03404000240fa5134ae435752365a5787894ca1

Intent: Backs the points requirement and table (mirror). Sliced to the statute table — buzer rotates ad blocks per request (observed 2026-09-02: three page variants, identical legal text). Official-source re-check tracked by the gesetze human-tier entry.

> … 2 10 1 11 1 12 1 Die Mindestpunktzahl beträgt sechs Punkte.…
Update the dataset value(s) with quote + retrieval date; move the old value into history.

## Resolved — 2026-09-09 (read by the session)

False alarm, and ours: nothing on the page moved. The entry's slice was bound
to the statute body on 2026-09-08 (commit `3030847`, 442 → 204
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
