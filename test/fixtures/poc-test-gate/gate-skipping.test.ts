/**
 * A fixture suite for `test/poc-test-gate.test.mjs`.
 *
 * Two skips in the two spellings that reach the report the same way: a declared
 * `test.skip`, and a `test.if(false)` whose condition is a runtime probe. `bun
 * test` prints both as `skip` and exits **0**, which is the whole reason the
 * census exists.
 */

import { expect, test } from "bun:test";

const PROBE_SATISFIED = false;

test("the one test beside the skips still runs", () => {
  expect(1).toBe(1);
});

test.skip("a declared skip", () => {
  throw new Error("a skipped body must never run");
});

test.if(PROBE_SATISFIED)("a conditional skip standing in for a missing toolchain", () => {
  throw new Error("a skipped body must never run");
});
