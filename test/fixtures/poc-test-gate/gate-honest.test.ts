/**
 * A fixture suite for `test/poc-test-gate.test.mjs`. It is deliberately NOT a
 * member of the runtime suite: `scripts/poc-test-gate.mjs` discovers only under
 * `poc/`, and `scripts/node-test-gate.mjs` discovers only `test/*.test.mjs`, so
 * nothing but the gate's own self-test ever runs this file.
 *
 * The honest control: everything runs, nothing is marked, and the gate must
 * report it green. The gate's job is to keep working, not to be strict.
 */

import { expect, test } from "bun:test";

test("an honest test runs", () => {
  expect(1 + 1).toBe(2);
});

test("a second honest test runs", () => {
  expect("smithers").toContain("smith");
});

test("a third honest test runs", () => {
  expect([1, 2, 3]).toHaveLength(3);
});
