/**
 * The control for the census's arithmetic: an ordinary failure must stay an
 * ordinary failure. A census that quietly reclassified failures as skips would
 * be a worse gate than the one it replaced.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("a test that passes", () => {
  assert.ok(true);
});

test("a test that fails", () => {
  assert.equal(1, 2);
});
