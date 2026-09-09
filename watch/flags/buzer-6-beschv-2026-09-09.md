# Watch flag: buzer-6-beschv — changed
- url: https://www.buzer.de/6_BeschV.htm
- kind: value-source
- date: 2026-09-09
- old: f81cdc992a27dfdbbd428b277139b5c4dbf3f5de139013500b6f8c7947f808a5
- new: 2bbd20d8bc77277490c710df1b7f3d0059e0971e328314afd006d0aa8e23d107

Intent: § 6 BeschV — the experienced-worker route. Backs the state-recognised-qualification limb and the IT exemption on de-experienced-worker.

> …(1) 1 Die Zustimmung zur Ausübung einer inländischen qualifizierten Beschäftigung kann Ausländerinnen und Ausländern ert…
Update the dataset value(s) with quote + retrieval date; move the old value into history.

## Resolved — 2026-09-09 (read by the session)

False alarm, and ours: nothing on the page moved. The entry's slice was bound
to the statute body on 2026-09-08 (commit `3030847`, 8,367 → 2,314
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
