import { expect, it } from "vitest";

// Throwaway (#121): proves the check workflow goes red on a failing case. Never merged.
it("fails on purpose, so the check's red path is seen on GitHub's runner", () => {
  expect(1).toBe(2);
});
