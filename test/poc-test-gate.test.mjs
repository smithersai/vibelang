/**
 * The runtime gate's own gate.
 *
 * `scripts/poc-test-gate.mjs` is what stands between `npm test` and a 2249-test
 * suite that quietly stopped covering something, so its census is measured
 * against real `bun test` runs rather than against hand-built records: the
 * load-bearing part is that the reporter *sees* a skip, a todo, or a vanished
 * sibling at all, and a unit test over a literal record array would pass even
 * if it never did.
 *
 * Both directions, because the point of the gate is to keep working, not to be
 * strict: an honest suite must stay green, the one named live-model skip must
 * stay allowed, an ordinary failure must stay an ordinary failure — and a suite
 * that turns its own coverage off must be refused with the reason named.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  census,
  coverageRefusals,
  discoverPocTestFiles,
  onlyMarkers,
  runPocTests,
} from "../scripts/poc-test-gate.mjs";

const fixtureDirectory = resolve("test/fixtures/poc-test-gate");
const pocDirectory = resolve("poc");

/** Silent, so a fixture suite's own report never interleaves with this run's. */
async function runFixture(pattern) {
  assert.ok(existsSync(fixtureDirectory), "the gate self-test needs test/fixtures/poc-test-gate");
  const completed = await runPocTests({
    cwd: fixtureDirectory,
    patterns: [pattern],
    stdio: ["ignore", "ignore", "ignore"],
  });
  assert.equal(
    completed.error?.code,
    undefined,
    "bun must be installed: the runtime suite is bun-only and this gate does not have a no-bun mode",
  );
  return completed;
}

test("the gate discovers the runtime suite and does not reach into test/fixtures", async () => {
  const discovered = await discoverPocTestFiles(pocDirectory);
  assert.ok(discovered.length > 100, `expected the whole runtime suite, discovered ${discovered.length} file(s)`);
  assert.ok(discovered.includes("examples/agent/anthropic-model.test.ts"));
  assert.ok(discovered.some((file) => file.startsWith("src/durable/")));
  assert.ok(discovered.some((file) => file.startsWith("src/concurrency/")));
  assert.deepEqual(
    discovered.filter((file) => file.startsWith("dist/") || file.includes("node_modules")),
    [],
    "emitted and vendored trees must not join the run",
  );
  for (const file of discovered) assert.ok(existsSync(join(pocDirectory, file)), `${file} must exist`);
  assert.deepEqual(
    await onlyMarkers(pocDirectory, discovered),
    [],
    "the runtime suite must contain no .only marker",
  );
});

test("an honest suite is censused as ran and is not refused", async () => {
  const completed = await runFixture("gate-honest");
  assert.equal(completed.code, 0, "the honest fixture suite must pass on its own");
  assert.equal(completed.declared, 3);
  const counted = census(completed.records);
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
  const completed = await runFixture("gate-skipping");
  // The premise of the whole gate: bun itself is perfectly happy with this.
  assert.equal(completed.code, 0, "bun test scores a skipped test as green, which is why the census exists");

  const counted = census(completed.records);
  assert.equal(counted.skipped.length, 2);
  assert.equal(counted.ran, 1, "a skipped test is never counted as a test that ran");
  assert.equal(counted.passed, 1);
  assert.match(counted.line, /skipped 2/);
  assert.match(counted.line, /a declared skip/);
  assert.match(counted.line, /a conditional skip standing in for a missing toolchain/);

  const refusals = coverageRefusals(completed.records);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /2 test\(s\) were skipped/);
  assert.match(refusals[0], /gate-skipping\.test\.ts:\d+: a declared skip/);
  assert.match(refusals[0], /gate-skipping\.test\.ts:\d+: a conditional skip/);
});

test("a todo is refused too: bun scores its failing body as non-failing", async () => {
  const completed = await runFixture("gate-todo");
  assert.equal(completed.code, 0, "the todo body fails and bun still exits 0");

  const counted = census(completed.records);
  assert.equal(counted.todo.length, 1, "a todo must not be collapsed into the skip count");
  assert.equal(counted.skipped.length, 0, "bun spells a todo with the same element as a skip; the message tells them apart");
  assert.equal(counted.ran, 1);
  assert.equal(counted.failed, 0, "the todo's failure is bun's to hide; the census reports it as a todo");

  const refusals = coverageRefusals(completed.records);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /marked todo/);
  assert.match(refusals[0], /a todo whose body fails: not implemented yet/);
});

test("the one live-model skip is allowed by name, and only at its own path", async () => {
  const completed = await runFixture("anthropic-model");
  assert.equal(completed.code, 0);
  const counted = census(completed.records);
  assert.equal(counted.skipped.length, 1);
  assert.equal(counted.passed, 1, "the test beside the allowance must still run");
  // Named, not counted: it appears in the census on every run, green ones
  // included, and it is still the only skip that does not refuse the run.
  assert.match(counted.line, /skipped 1/);
  assert.match(counted.line, /SMITHERS_LIVE_MODEL/);
  assert.deepEqual(coverageRefusals(completed.records), []);

  // The allowance is keyed on the path as well as the name: the same skip
  // anywhere else is still a refusal.
  const moved = completed.records.map((record) => ({ ...record, file: "src/durable/store.test.ts" }));
  const refusals = coverageRefusals(moved);
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /1 test\(s\) were skipped/);
  assert.match(refusals[0], /src\/durable\/store\.test\.ts/);
});

test("a .only marker is refused: the siblings it drops are absent from the report entirely", async () => {
  const completed = await runFixture("gate-only");
  // Three tests are authored in that file. bun runs one, exits 0, and reports
  // nothing at all about the other two — not as skips, not as todos. Nothing in
  // the report can see the loss, which is why the gate reads the source.
  assert.equal(completed.code, 0, "bun exits 0 with two thirds of the file silently unrun");
  assert.equal(completed.records.length, 1);
  assert.equal(completed.declared, 1);
  const counted = census(completed.records);
  assert.equal(counted.skipped.length, 0);
  assert.equal(counted.todo.length, 0);
  assert.deepEqual(
    coverageRefusals(completed.records),
    [],
    "the report alone is blind to it; this is the measurement that justifies the source scan",
  );

  const markers = await onlyMarkers(fixtureDirectory, ["gate-only.test.ts"]);
  assert.equal(markers.length, 1);
  assert.match(markers[0], /gate-only\.test\.ts:\d+: test\.only\(/);
  const refusals = coverageRefusals(completed.records, { markers });
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /1 \.only marker\(s\)/);
  assert.match(refusals[0], /silently drops its siblings/);
});

test("an ordinary failure stays an ordinary failure", async () => {
  const completed = await runFixture("gate-failing");
  assert.notEqual(completed.code, 0, "bun must still fail the run");
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

test("a discovered file that contributed nothing is named rather than subtracted", async () => {
  const completed = await runFixture("gate-honest");
  const refusals = coverageRefusals(completed.records, {
    discoveredFiles: ["gate-honest.test.ts", "gate-failing.test.ts", "examples/agent/anthropic-model.test.ts"],
  });
  assert.equal(refusals.length, 1);
  assert.match(refusals[0], /2 discovered test file\(s\) contributed no test/);
  assert.match(refusals[0], /contributed nothing: gate-failing\.test\.ts/);
  assert.match(refusals[0], /contributed nothing: examples\/agent\/anthropic-model\.test\.ts/);

  // And the mirror: a report naming a file the gate never discovered means the
  // census does not describe the run.
  const undiscovered = coverageRefusals(completed.records, { discoveredFiles: ["gate-failing.test.ts"] });
  assert.equal(undiscovered.length, 2);
  assert.ok(undiscovered.some((refusal) => /undiscovered: gate-honest\.test\.ts/.test(refusal)));
});
