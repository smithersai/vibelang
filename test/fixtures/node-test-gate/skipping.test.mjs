/**
 * The shape the gate has to refuse: a toolchain probe that turns the whole
 * file's coverage off while `node --test` still exits 0. See the sibling
 * `honest.test.mjs` for the control.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("a test that runs beside the skipped ones", () => {
  assert.ok(true);
});

test("a declared skip", { skip: "bun is required for the conformance harness" }, () => {
  assert.fail("a skipped body never runs");
});

test("a runtime skip", (t) => {
  t.skip("pinned smithersai/TypeScript checkout is absent");
});
