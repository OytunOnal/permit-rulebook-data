import { defineConfig } from "vitest/config";

/**
 * Room for a slow machine.
 *
 * The property tests here are the expensive kind on purpose: they walk hundreds
 * of generated profiles through the whole engine, and the invariant that no
 * user-facing string is a field id renders every reason for every route over
 * 2,000 of them. On this laptop that one takes 3.7 s of the 5 s Vitest allows
 * by default — 74% of the budget — and on GitHub's two-vCPU runner it ran out
 * and failed the build (`tests/verdict.test.ts`, CI 2026-09-08).
 *
 * Measured here, worst first: 3.7 s (verdict — field ids), 2.4 s (properties —
 * the interview terminates), 2.4 s (properties — nothing unanswered could
 * change a verdict), 1.4 s (properties — unlock rows), 0.9 s (s5f — the band
 * ladder). Three of those sit within 2x of the default, so raising one test's
 * timeout would only move the failure to the next one.
 *
 * 60 s is not a guess at how slow a runner might be; it is far enough above the
 * slowest test that no plausible machine reaches it, while still bounding a
 * genuinely hung test. The cost is stated: a hang now takes a minute to report
 * instead of five seconds, against a suite whose whole run is about ten.
 *
 * The alternative — cutting the number of generated profiles — would buy the
 * time back out of the coverage these tests exist for, and is refused.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
