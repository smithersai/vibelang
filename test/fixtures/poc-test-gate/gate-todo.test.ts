/**
 * A fixture suite for `test/poc-test-gate.test.mjs`.
 *
 * The todo's body fails, and `bun test` still exits 0 and prints it as a todo
 * rather than as a failure. In the JUnit report a todo is `<skipped
 * message="TODO" />` — the same element as a skip — so a census that did not
 * read the message would collapse the two categories the gate reports apart.
 */

import { expect, test } from "bun:test";

test("the one test beside the todo still runs", () => {
  expect(1).toBe(1);
});

test.todo("a todo whose body fails: not implemented yet", () => {
  expect(1).toBe(2);
});
