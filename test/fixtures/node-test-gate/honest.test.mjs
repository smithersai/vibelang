/**
 * A fixture suite for `test/node-test-gate.test.mjs`. It is deliberately NOT a
 * top-level `test/*.test.mjs` file: the gate discovers the root suite with a
 * non-recursive readdir of `test/`, so nothing here joins the real run.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("an honest test asserts something", () => {
  assert.equal(1 + 1, 2);
});

test("an honest suite may nest", async (t) => {
  await t.test("and the nested test also runs", () => {
    assert.ok(true);
  });
});
