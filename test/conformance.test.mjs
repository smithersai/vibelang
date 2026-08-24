/**
 * Smithers differential conformance gate.
 *
 * Two very different jobs live in this file, deliberately:
 *
 *   1. The JS instrument (`poc/src/language`) is run over the whole `.sm`
 *      corpus and every declared expectation must hold. This is a real
 *      regression gate today: the corpus is the language contract, so a change
 *      that alters an accepted program's output, or that moves/renames/loses a
 *      diagnostic, fails the build here.
 *
 *   2. The pinned Go fork is run over the same corpus in report-only mode. It
 *      is the migration target, not yet the implementation, so it prints its
 *      match count and never fails the build. The headline number that matters
 *      while the semantics move into Go is "N/M cases the Go backend matches
 *      the reference"; watching it climb is the point of the harness.
 *
 * Both halves skip cleanly with an actionable message when their toolchain is
 * absent, so `npm test` stays green on a machine that has not fetched the fork.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { runConformance } from "../conformance/runner/run.mjs";
import { loadCorpus, loadInterop } from "../conformance/runner/corpus.mjs";
import { prepareGoBackend } from "../conformance/runner/backend-go.mjs";
import { jsBackend } from "../conformance/runner/backend-js.mjs";
import { auditVerdict, judge } from "../conformance/runner/judge.mjs";

function missingTool(command, argument) {
  const probe = spawnSync(command, [argument], { encoding: "utf8" });
  return probe.error || probe.status !== 0 ? `${command} is required for the conformance harness` : undefined;
}

const skipJs = missingTool("bun", "--version");

function describeFailures(entries, backend) {
  return entries
    .filter((entry) => entry.results[backend]?.status === "fail")
    .map((entry) => `  ${entry.id}: ${entry.results[backend].detail}`)
    .join("\n");
}

test("the corpus is well formed", () => {
  const cases = loadCorpus();
  const interop = loadInterop();
  assert.ok(cases.length > 0, "the conformance corpus must not be empty");
  assert.ok(interop.length > 0, "the interop spot-check must not be empty");
  const areas = new Set(cases.map((entry) => entry.area));
  assert.ok(areas.size >= 10, `expected the corpus to cover the language's semantic areas, saw ${areas.size}`);
  const ids = new Set();
  for (const entry of cases) {
    assert.ok(!ids.has(entry.id), `duplicate case id ${entry.id}`);
    ids.add(entry.id);
  }
});

/**
 * Deliberately break an expectation and require the runner to notice.
 *
 * A conformance harness is only worth its numbers if a wrong answer actually
 * turns a row red. This test mutates real corpus cases in memory — never on
 * disk — and runs them through the real JS backend, so it exercises the whole
 * pipeline rather than the judge in isolation. Each mutation targets one shape
 * of wrongness the harness has to be able to see.
 */
test("the runner notices a broken expectation", { skip: skipJs, timeout: 300_000 }, async () => {
  const cases = loadCorpus();
  const pick = (id) => {
    const found = cases.find((entry) => entry.id === id);
    assert.ok(found, `the self-test needs the corpus case ${id}`);
    return found;
  };
  const mutate = (testCase, expectation) => ({
    ...testCase,
    id: `${testCase.id}#mutated`,
    expectation: { ...testCase.expectation, ...expectation },
  });

  const output = pick("01-result-lifting/return-lifts-into-success");
  const diagnostics = pick("02-unwrap-propagation/unwrap-at-top-level-is-rejected");
  // The case whose emitted TypeScript the stock checker rejects. Declaring it
  // as an output case is exactly the false pretense the harness used to accept:
  // if `checkEmittedProject` is ever dropped from the JS backend again, this
  // row goes green and this assertion goes red.
  const emitCheck = pick(
    "14-conditional-declarations/conditional-declaration-binding-does-not-escape-the-construct",
  );

  const report = await runConformance({
    backend: "js",
    cases: [
      mutate(output, { stdout: [...output.expectation.stdout.slice(0, -1), "a line the program never prints"] }),
      mutate(diagnostics, {
        diagnostics: diagnostics.expectation.diagnostics.map((entry) => ({ ...entry, column: entry.column + 1 })),
      }),
      mutate(emitCheck, { expect: "output", stdout: ["a,b"], diagnostics: undefined, notes: undefined }),
    ],
  });

  assert.ok(report.backends.js?.available, report.backends.js?.reason);
  assert.deepEqual(report.audit, [], "the mutated run must not trip the integrity audit, only the verdicts");
  const statuses = report.cases.map((entry) => [entry.id, entry.results.js?.status]);
  for (const [id, status] of statuses) {
    assert.equal(status, "fail", `the runner scored the deliberately broken case ${id} as ${status}`);
  }
  assert.equal(report.summary.js.fail, 3);
  assert.equal(report.summary.js.pass, 0);

  const emitRow = report.cases.find((entry) => entry.id.startsWith(emitCheck.id));
  assert.match(
    emitRow.results.js.detail,
    /TS2304/,
    "the JS backend must type-check the emitted TypeScript, not just lower it",
  );
});

/**
 * The audit that backs the test above: a verdict is only allowed to be a pass
 * if the observation records the stages that verdict depends on.
 */
test("a pass that skipped a stage is a harness-integrity failure, not a pass", () => {
  const testCase = loadCorpus().find((entry) => entry.expectation.expect === "output");
  const complete = {
    kind: "output",
    stages: ["lower", "emit-check", "execute"],
    stdout: testCase.expectation.stdout,
    exitCode: 0,
    stderr: "",
  };
  const verdict = judge(testCase, complete, "js");
  assert.equal(verdict.status, "pass");
  assert.deepEqual(auditVerdict(testCase, complete, verdict, jsBackend), []);

  // The exact shape the backend had before C17: lowered, never checked, run.
  const unchecked = { ...complete, stages: ["lower", "execute"] };
  const uncheckedViolations = auditVerdict(testCase, unchecked, judge(testCase, unchecked, "js"), jsBackend);
  assert.equal(uncheckedViolations.length, 1, "a pass without the emit-check stage must be reported");
  assert.match(uncheckedViolations[0], /emit-check/);

  // And an observation that claims nothing at all cannot buy a pass either.
  const empty = { ...complete, stages: [] };
  assert.equal(auditVerdict(testCase, empty, judge(testCase, empty, "js"), jsBackend).length, 1);
});

/**
 * A backend that cannot answer is never scored as a result. `unsupported` is a
 * claim about the implementation; a crash is a claim about the harness.
 */
test("a crashed or refusing backend is scored as a failure to measure", () => {
  const testCase = loadCorpus()[0];
  for (const observation of [
    { kind: "error", stages: [], reason: "could not run bun" },
    { kind: "rejected", stages: [], reason: "smithersc-go rejected the request (exit 64)" },
  ]) {
    for (const backend of ["js", "go"]) {
      const verdict = judge(testCase, observation, backend);
      assert.equal(
        verdict.status,
        "unmeasured",
        `${backend} scored ${observation.kind} as ${verdict.status} instead of unmeasured`,
      );
    }
  }
});

test(
  "the JS instrument satisfies every conformance expectation",
  { skip: skipJs, timeout: 900_000 },
  async (t) => {
    const report = await runConformance({ backend: "js", interop: true });
    assert.ok(report.backends.js?.available, report.backends.js?.reason);

    // Integrity before verdicts: if a pass was not backed by the checks it
    // claims, or the summary disagrees with its rows, the numbers below are
    // not evidence of anything.
    assert.deepEqual(report.audit, [], `the harness reported integrity failures:\n${report.audit.join("\n")}`);

    const summary = report.summary;
    t.diagnostic(
      `JS reference: ${summary.js.pass + summary.js.xpass}/${summary.js.total} corpus cases, ` +
        `${summary.js.xfail} xfail, ${summary.jsInterop.pass}/${summary.jsInterop.total} interop`,
    );

    assert.equal(
      summary.js.fail,
      0,
      `the JS reference must satisfy every corpus expectation:\n${describeFailures(report.cases, "js")}`,
    );
    assert.equal(
      summary.jsInterop.fail,
      0,
      `plain TypeScript must keep its behavior:\n${describeFailures(report.interop, "js")}`,
    );
    // A case the harness could not measure is never a pass and never a skip.
    assert.equal(summary.js.unmeasured, 0, "every corpus case must have been measured");
    assert.equal(summary.jsInterop.unmeasured, 0, "every interop file must have been measured");

    // An xpass means a case marked xfail now behaves as the specification says.
    // That is good news, but the marker has to be retired deliberately, so it
    // is surfaced rather than silently accepted.
    for (const entry of report.cases) {
      if (entry.results.js?.status === "xpass") {
        t.diagnostic(`xpass: ${entry.id} — ${entry.results.js.detail}`);
      }
    }
  },
);

test("the Go fork's conformance is measured, not gated", { timeout: 1_800_000 }, async (t) => {
  if (skipJs) {
    t.skip(skipJs);
    return;
  }
  const probe = await prepareGoBackend();
  if (probe.unavailable) {
    t.skip(probe.unavailable);
    return;
  }
  await probe.dispose();

  const report = await runConformance({ backend: "go", interop: true });
  assert.ok(report.backends.go?.available, report.backends.go?.reason);
  assert.deepEqual(report.audit, [], `the harness reported integrity failures:\n${report.audit.join("\n")}`);
  const summary = report.summary;

  t.diagnostic(
    `Go fork match: ${summary.go.pass}/${summary.go.total} corpus cases match the reference ` +
      `(${summary.go.unsupported} unsupported, ${summary.go.fail} divergent)`,
  );
  t.diagnostic(`Go interop: ${summary.goInterop.pass}/${summary.goInterop.total} plain TypeScript files`);
  for (const entry of report.cases) {
    if (entry.results.go?.status === "fail") {
      t.diagnostic(`divergent: ${entry.id} — ${entry.results.go.detail}`);
    }
  }

  // Report-only, by design: the Go backend is mid-migration. The only thing
  // asserted is that the harness itself produced a verdict for every case, so a
  // silently empty measurement cannot masquerade as progress.
  assert.equal(
    summary.go.total,
    report.cases.length,
    "every corpus case must receive a Go verdict, even if that verdict is unsupported",
  );
  // Report-only covers "the fork does not do this yet" and "the fork does it
  // differently". It does not cover "the harness never found out", which would
  // otherwise inflate `unsupported` with cases nobody measured.
  assert.equal(summary.go.unmeasured, 0, "a Go case that could not be measured is a harness failure, not a result");
  assert.equal(summary.goInterop.unmeasured, 0, "an interop file that could not be measured is a harness failure");
});
