/**
 * The pre-merge gate's wiring, checked in milliseconds.
 *
 * `scripts/verify-pack.mjs` asserts the same thing, but it asserts it at the top
 * of a run that takes roughly half an hour. This file is the cheap end of the
 * same assertion, so a wiring mistake is found by the suite it would break
 * rather than by the release it would break. Both call
 * `gateCompositionViolations`, so there is one statement of the rule and no
 * second copy to go stale.
 *
 * The negative cases matter more than the positive one. A composition check that
 * only ever sees a correct package.json is a check nobody has watched fail, and
 * the two wirings it exists to stop — `npm test` reaching `verify:pack`
 * (unbounded recursion, because `prepack` is `npm run test`) and a pre-merge
 * script that runs the suites itself on top of a gate that already runs them —
 * are exactly the two an author reaching for "just add it to npm test" would
 * write.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { gateCompositionViolations, REQUIRED_TEST_STAGES } from "../scripts/gate-composition.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")).scripts;

test("the pre-merge gate runs the suites and the packaging verification, once each", async (t) => {
  await t.test("this package's own wiring is sound", () => {
    assert.deepEqual(gateCompositionViolations(scripts), []);
  });

  await t.test("the pre-merge gate exists and reaches the packaging gate", () => {
    // The whole point of P1: `scripts/release-fixtures/**` runs nowhere else,
    // so nothing else can see a change to the shipped durable surface before
    // merge.
    assert.equal(typeof scripts["gate:premerge"], "string");
    assert.match(scripts["gate:premerge"], /verify:pack/);
    // And `npm test` is still a usable inner loop on its own — it must not have
    // grown the packaging gate, which is the recursion.
    assert.doesNotMatch(scripts.test, /verify:pack|gate:premerge/);
    for (const stage of REQUIRED_TEST_STAGES) assert.match(scripts.test, new RegExp(stage.replace(/[.]/g, "\\.")));
  });

  await t.test("a `npm test` that reaches the packaging gate is refused", () => {
    const violations = gateCompositionViolations({
      ...scripts,
      test: `${scripts.test} && npm run verify:pack`,
    });
    assert.ok(
      violations.some((text) => text.includes("unbounded")),
      JSON.stringify(violations),
    );
  });

  await t.test("a pre-merge script that runs the suites twice is refused", () => {
    const violations = gateCompositionViolations({
      ...scripts,
      "gate:premerge": "npm test && npm run verify:pack",
    });
    assert.ok(
      violations.some((text) => text.includes("twice")),
      JSON.stringify(violations),
    );
  });

  await t.test("a weakened prepack or a shrunken `npm test` is refused", () => {
    // Both are the same failure in two spellings: the pre-merge gate inherits
    // the suites rather than enumerating them, so anything that removes a suite
    // upstream of it removes it from the gate without any gate turning red.
    assert.ok(
      gateCompositionViolations({ ...scripts, prepack: "npm run build" })
        .some((text) => text.includes("prepack contract")),
    );
    const shrunk = gateCompositionViolations({
      ...scripts,
      test: scripts.test.replace(" && node scripts/poc-test-gate.mjs", ""),
    });
    assert.ok(
      shrunk.some((text) => text.includes("scripts/poc-test-gate.mjs")),
      JSON.stringify(shrunk),
    );
  });

  await t.test("a release that runs the suites on top of the gate is refused", () => {
    const violations = gateCompositionViolations({
      ...scripts,
      "release:verify": "npm test && npm run gate:premerge",
    });
    assert.ok(
      violations.some((text) => text.includes("release:verify")),
      JSON.stringify(violations),
    );
  });
});
