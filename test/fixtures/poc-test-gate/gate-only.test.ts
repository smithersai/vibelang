/**
 * A fixture suite for `test/poc-test-gate.test.mjs`.
 *
 * The shape the report cannot show. `bun test` without `--only` still honours a
 * source `test.only`: this file runs one test and its two siblings do not
 * appear in the JUnit output *at all* — not as skips, not as todos, not as
 * anything. The suite exits 0. The only place that loss is visible is the
 * source, which is why the gate reads it there.
 */

import { expect, test } from "bun:test";

test("a sibling that silently does not run", () => {
  expect(1).toBe(1);
});

test.only("the only test that runs", () => {
  expect(1).toBe(1);
});

test("a second sibling that silently does not run", () => {
  expect(1).toBe(1);
});
