/**
 * VibeLang delivery-profile conformance gate. Both compiler paths now use Go;
 * "js" and "go" are compatibility labels, not independent implementations.
 *
 * Two very different jobs live in this file, deliberately:
 *
 *   1. The JS instrument (`poc/src/language`) is run over the whole `.vibe`
 *      corpus and every declared expectation must hold. This is a real
 *      regression gate today: the corpus is the language contract, so a change
 *      that alters an accepted program's output, or that moves/renames/loses a
 *      diagnostic, fails the build here.
 *
 *   2. The pinned Go fork is run over the same corpus. Reviewed xfail markers
 *      record its narrower implementation; new divergences, unmarked unsupported
 *      cases, stale markers, and ordinary TypeScript interop failures gate here.
 *
 * An absent toolchain is reported as a skip here and refused by the enclosing
 * Node gate's census. `npm test` cannot pass without measuring both backends.
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

function describeFailures(entries, backend, statuses = ["fail"]) {
  return entries
    .filter((entry) => statuses.includes(entry.results[backend]?.status))
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
  const sourceCheckedOnly = { ...complete, stages: ["lower", "source-check", "execute"] };
  assert.match(auditVerdict(testCase, sourceCheckedOnly, verdict, jsBackend).join("\n"), /emit-check/,
    "source checking must not stand in for emitted-code checking of an executed program");

  // And an observation that claims nothing at all cannot buy a pass either.
  const empty = { ...complete, stages: [] };
  assert.equal(auditVerdict(testCase, empty, judge(testCase, empty, "js"), jsBackend).length, 1);
});

test("a native source refusal earns a TS diagnostic verdict without pretending to emit", () => {
  const testCase = { id: "native-source-refusal", entry: "main.vibe", expectation: {
    expect: "diagnostics", diagnostics: [{ code: "TS2322", line: 1, column: 5 }],
  } };
  const observed = { kind: "diagnostics", stages: ["lower", "source-check"], diagnostics: [
    { code: "TS2322", file: "main.vibe", line: 1, column: 5, message: "type mismatch", mapped: true },
  ] };
  const verdict = judge(testCase, observed, "js");
  assert.equal(verdict.status, "pass");
  assert.deepEqual(auditVerdict(testCase, observed, verdict, jsBackend), []);
  assert.match(auditVerdict(testCase, { ...observed, stages: ["lower"] }, verdict, jsBackend).join("\n"),
    /TS-code expectation.*emit-check or source-check/);
});

/**
 * A backend that cannot answer is never scored as a result. `unsupported` is a
 * claim about the implementation; a crash is a claim about the harness.
 */
test("a crashed or refusing backend is scored as a failure to measure", () => {
  const testCase = loadCorpus()[0];
  for (const observation of [
    { kind: "error", stages: [], reason: "could not run bun" },
    { kind: "rejected", stages: [], reason: "vibec-go rejected the request (exit 64)" },
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
    assert.equal(summary.js.unmeasured, 0,
      `every corpus case must have been measured:\n${describeFailures(report.cases, "js", ["unmeasured"])}`);
    assert.equal(summary.jsInterop.unmeasured, 0,
      `every interop file must have been measured:\n${describeFailures(report.interop, "js", ["unmeasured"])}`);

    // An xpass means a case marked xfail now behaves as the specification says.
    // That is good news, but the marker has to be retired deliberately, so it
    // is surfaced rather than silently accepted.
    for (const entry of report.cases) {
      if (entry.results.js?.status === "xpass") {
        t.diagnostic(`xpass: ${entry.id} — ${entry.results.js.detail}`);
      }
    }
    assert.equal(summary.js.xpass, 0, "retire stale reference xfail markers after verifying the implemented behavior");
    assert.equal(summary.js.unsupported, 0, "an unmarked unsupported case is a reference regression");
    assert.equal(summary.jsInterop.unsupported, 0, "all ordinary TypeScript interop cases must execute");
    assert.deepEqual(summary.failOpenMarkers?.js ?? [], [], "an xfail marker must not hide accepting a required refusal");
  },
);

test("the Go fork satisfies the reviewed conformance baseline and plain TypeScript interop", { timeout: 1_800_000 }, async (t) => {
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

  // Gating, since 2026-09-05. The Go backend is still mid-migration, and the
  // corpus records that honestly: a case the fork cannot run yet carries an
  // `xfail` marker naming the backend and the reason (conformance/README.md
  // keeps the register). What must never happen silently is a NEW divergence —
  // a case with no marker whose Go verdict disagrees with the reference — or a
  // marker that has gone stale because the fork caught up (`xpass`). Both were
  // report-only before, so `npm test` could go green over a fresh Go regression.
  const divergent = report.cases.filter((entry) => entry.results.go?.status === "fail").map((entry) => entry.id);
  assert.deepEqual(
    divergent,
    [],
    `the Go backend diverges from the reference on unmarked cases; fix the fork or add an xfail marker with its reason:\n${divergent.join("\n")}`,
  );
  const xpass = report.cases.filter((entry) => entry.results.go?.status === "xpass").map((entry) => entry.id);
  assert.deepEqual(
    xpass,
    [],
    `these xfail(go) markers are stale — the fork now agrees; retire them in the case and in conformance/README.md:\n${xpass.join("\n")}`,
  );
  assert.equal(
    summary.go.total,
    report.cases.length,
    "every corpus case must receive a Go verdict, even if that verdict is unsupported",
  );
  assert.equal(summary.go.unsupported, 0, "unsupported Go cases need a reviewed per-case baseline, not an unmarked escape");
  assert.equal(summary.goInterop.fail, 0, `plain TypeScript must keep its behavior:\n${describeFailures(report.interop, "go")}`);
  assert.equal(summary.goInterop.unsupported, 0, "all ordinary TypeScript interop cases must execute");
  assert.deepEqual(summary.failOpenMarkers?.go ?? [], [], "an xfail marker must not hide accepting a required refusal");
  // A missing observation is never an expected implementation limitation.
  assert.equal(summary.go.unmeasured, 0,
    `a Go case that could not be measured is a harness failure, not a result:\n${describeFailures(report.cases, "go", ["unmeasured"])}`);
  assert.equal(summary.goInterop.unmeasured, 0,
    `an interop file that could not be measured is a harness failure:\n${describeFailures(report.interop, "go", ["unmeasured"])}`);
});
