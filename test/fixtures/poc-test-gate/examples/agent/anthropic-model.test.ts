/**
 * A fixture suite for `test/poc-test-gate.test.mjs`, laid out at the same
 * relative path as the real file so the gate's one named allowance is measured
 * against a report bun actually produced rather than against a hand-built
 * record. `scripts/poc-test-gate.mjs` matches an allowed skip by that relative
 * path plus the name, so the directories here are load-bearing.
 *
 * The real `poc/examples/agent/anthropic-model.test.ts:378` gates a live
 * Anthropic API call on `SMITHERS_LIVE_MODEL`; this mirrors its shape.
 */

import { expect, test } from "bun:test";

const LIVE = false;

test("a test beside the live-model skip", () => {
  expect(1).toBe(1);
});

test.if(LIVE)("answers a real request (set SMITHERS_LIVE_MODEL=1 with a credential to run)", () => {
  throw new Error("the live-model body must not run without a credential");
});
