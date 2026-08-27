/**
 * A fixture suite for `test/poc-test-gate.test.mjs`.
 *
 * An ordinary failure must stay an ordinary failure: refused by the exit code
 * and the failure count, never reclassified into the coverage census.
 */

import { expect, test } from "bun:test";

test("a passing test beside the failure", () => {
  expect(1).toBe(1);
});

test("an ordinary failure", () => {
  expect("this test").toBe("deliberately failing");
});
