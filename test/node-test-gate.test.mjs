/**
 * The root Node gate's own gate.
 *
 * `scripts/node-test-gate.mjs` is what stands between `npm test` and a green
 * run that did nothing, so its census has to be measured against real
 * `node --test` runs rather than against hand-built records: the load-bearing
 * part is that the reporter *sees* a skip at all, and a unit test over a
 * literal record array would pass even if it never did.
 *
 * Both directions, because the point of the gate is to keep working, not to be
 * strict: an honest suite must stay green, and a suite that quietly turns its
 * own coverage off must be refused with the reason named.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  census,
  coverageRefusals,
  discoverTestFiles,
  runNodeTestFiles,
} from "../scripts/node-test-gate.mjs";

const fixtureDirectory = "test/fixtures/node-test-gate";

/** Silent, so a fixture suite's own report never interleaves with this run's. */
async function runFixtures(...names) {
  const files = names.map((name) => join(fixtureDirectory, name));
  for (const file of files) assert.ok(existsSync(file), `the gate self-test needs the fixture ${file}`);
  return runNodeTestFiles({ testFiles: files, stdio: ["ignore", "ignore", "ignore"] });
}

test("the gate discovers the root suite and does not reach into test/fixtures", async () => {
  const discovered = await discoverTestFiles(join(process.cwd(), "test"));
  assert.ok(discovered.includes("test/node-test-gate.test.mjs"), "the gate must discover this very file");
  assert.ok(discovered.length > 1);
  assert.deepEqual(
    discovered.filter((file) => file.includes("fixtures")),
    [],
    "the fixture suites must not join the root run",
  );
});

test("an honest suite is censused as ran and is not refused", async () => {
  const completed = await runFixtures("honest.test.mjs");
  assert.equal(completed.code, 0, "the honest fixture suite must pass on its own");
  assert.equal(completed.malformed, false);
  assert.equal(completed.censusUnreadable, undefined);

  const counted = census(completed.records);
  // Two top-level tests plus the one nested test.
  assert.equal(counted.ran, 3);
  assert.equal(counted.passed, 3);
  assert.equal(counted.failed, 0);
  assert.equal(counted.skipped.length, 0);
  assert.equal(counted.todo.length, 0);
  assert.match(counted.line, /ran 3 \(passed 3, failed 0\), skipped 0, todo 0/);
  assert.match(counted.line, /skip reasons: none/);
  assert.deepEqual(coverageRefusals(completed.records), []);
});

test("a suite that skips its own coverage is refused, with the file and reason named", async () => {
  const completed = await runFixtures("skipping.test.mjs");
  // The premise of the whole gate: node itself is perfectly happy with this.
  assert.equal(completed.code, 0, "node --test scores a skipped test as green, which is why the census exists");

  const counted = census(completed.records);
  assert.equal(counted.skipped.length, 2);
  assert.equal(counted.ran, 1, "a skipped test is never counted as a test that ran");
  assert.equal(counted.passed, 1);
  assert.match(counted.line, /skipped 2/);
  assert.match(counted.line, /bun is required for the conformance harness/);
  assert.match(counted.line, /pinned smithersai\/TypeScript checkout is absent/);

  const refusals = coverageRefusals(completed.records);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /2 test\(s\) were skipped/);
  assert.match(refusals[0], /skipping\.test\.mjs:a declared skip/);
  assert.match(refusals[0], /skipping\.test\.mjs:a runtime skip/);
  assert.match(refusals[0], /bun is required for the conformance harness/);
});

test("a todo is refused too: node scores its failing body as non-failing", async () => {
  const completed = await runFixtures("todo.test.mjs");
  assert.equal(completed.code, 0, "the todo body fails and node still exits 0");

  const counted = census(completed.records);
  assert.equal(counted.todo.length, 1);
  assert.equal(counted.ran, 1);
  assert.equal(counted.failed, 0, "the todo's failure is node's to hide; the census reports it as a todo");

  const refusals = coverageRefusals(completed.records);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /marked todo/);
  assert.match(refusals[0], /todo\.test\.mjs:a todo whose body fails/);
  assert.match(refusals[0], /not implemented yet/);
});

test("an ordinary failure stays an ordinary failure", async () => {
  const completed = await runFixtures("failing.test.mjs");
  assert.notEqual(completed.code, 0, "node must still fail the run");
  const counted = census(completed.records);
  assert.equal(counted.failed, 1);
  assert.equal(counted.passed, 1);
  assert.equal(counted.skipped.length, 0, "a failure must never be reclassified as a skip");
  assert.equal(counted.todo.length, 0);
  assert.deepEqual(
    coverageRefusals(completed.records),
    [],
    "a failing run is refused by its exit code and its failure count, not by the coverage census",
  );
});

test("a mixed run reports every category separately", async () => {
  const completed = await runFixtures("honest.test.mjs", "skipping.test.mjs", "todo.test.mjs");
  const counted = census(completed.records);
  assert.equal(counted.skipped.length, 2);
  assert.equal(counted.todo.length, 1);
  // honest: two top-level plus one nested; skipping: the one beside the skips;
  // todo: the one beside the todo.
  assert.equal(counted.ran, 5);
  assert.equal(counted.failed, 0);
  assert.equal(coverageRefusals(completed.records).length, 2, "skips and todos are reported as separate refusals");
});
