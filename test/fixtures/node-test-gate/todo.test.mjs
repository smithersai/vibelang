/**
 * `node --test` reports a failing `todo` test as non-failing and exits 0, so a
 * todo is the same fail-open shape as a skip wearing a different word.
 */
import assert from "node:assert/strict";
import test from "node:test";

test("a test that runs beside the todo", () => {
  assert.ok(true);
});

test("a todo whose body fails", { todo: "not implemented yet" }, () => {
  assert.fail("and node still exits 0");
});
