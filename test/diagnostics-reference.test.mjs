import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forkCensus, referenceCensus } from "../scripts/coverage-codes.mjs";
import { validateDiagnosticObservation } from "../scripts/diagnostics-observation.mjs";

const document = readFileSync(new URL("../docs/src/pages/reference/diagnostics.mdx", import.meta.url), "utf8");
const [observed, unobserved] = document.split("## Defined but not observed in this SDK corpus run");
const codesIn = text => new Set([...text.matchAll(/^\| `(VIBE\d{4})` \|/gm)].map(match => match[1]));

test("the diagnostic reference accounts for every implementation report-site code", () => {
  assert.ok(unobserved, "the reference must separate observed messages from implementation-only inventory");
  const rows = codesIn(document);
  const implemented = new Set([...referenceCensus().reported, ...forkCensus().reported]);
  const missing = [...implemented].filter(code => !rows.has(code)).sort();
  assert.deepEqual(missing, [], "regenerate the reference; an implementation code must not silently disappear");
});

test("unobserved diagnostic availability uses the coverage census, not mentions or one source directory", () => {
  assert.ok(unobserved);
  const reference = referenceCensus().reported;
  const fork = forkCensus().reported;
  const observedCodes = codesIn(observed);
  const expected = [...new Set([...reference, ...fork])].filter(code => !observedCodes.has(code)).sort()
    .map(code => `| \`${code}\` | ${reference.has(code) ? "yes" : "—"} | ${fork.has(code) ? "yes" : "—"} |`);
  const actual = unobserved.split("\n").filter(line => /^\| `VIBE\d{4}` \|/.test(line));
  assert.deepEqual(actual, expected);
});

const observedRun = () => ({ cases: [
  { id: "a", results: { js: { status: "pass", observation: { kind: "diagnostics", diagnostics: [{ code: "VIBE1101", message: "refused" }] } } } },
  { id: "b", results: { js: { status: "pass", observation: { kind: "output", stdout: ["42"], exitCode: 0 } } } },
] });
const runnerExit = { status: 0, signal: null };

test("diagnostic generation requires a complete successful measurement, not just JSON on stdout", () => {
  assert.doesNotThrow(() => validateDiagnosticObservation(runnerExit, observedRun(), ["a", "b"]));
  for (const failure of [{ status: 1 }, { status: 2 }, { status: 3 }, { status: null }, { signal: "SIGKILL" }, { error: new Error("spawn failed") }]) {
    assert.throws(() => validateDiagnosticObservation({ ...runnerExit, ...failure }, observedRun(), ["a", "b"]), /existing documentation was not changed/);
  }
  for (const invalid of [null, {}, { cases: [] }, { cases: observedRun().cases.slice(0, 1) }, { cases: [observedRun().cases[0], observedRun().cases[0]] }]) {
    assert.throws(() => validateDiagnosticObservation(runnerExit, invalid, ["a", "b"]));
  }
});

test("diagnostic generation rejects unmeasured and malformed case observations", () => {
  for (const patch of [
    { status: "unmeasured" }, { status: "unsupported" }, { status: "not-run" }, { status: undefined },
    { observation: undefined }, { observation: { kind: "error", reason: "backend unavailable" } },
    { observation: { kind: "rejected" } }, { observation: { kind: "diagnostics", diagnostics: null } },
    { observation: { kind: "diagnostics", diagnostics: [{ code: "VIBE1101" }] } },
    { observation: { kind: "output", stdout: null, exitCode: 0 } }, { observation: { kind: "output", stdout: [], exitCode: null } },
    { observation: { kind: "unsupported", reason: "not measured" } },
  ]) {
    const report = observedRun(); Object.assign(report.cases[0].results.js, patch);
    assert.throws(() => validateDiagnosticObservation(runnerExit, report, ["a", "b"]));
  }
  const expected = observedRun();
  expected.cases[0].results.js = { status: "xfail", observation: { kind: "unsupported", reason: "declared limitation" } };
  assert.doesNotThrow(() => validateDiagnosticObservation(runnerExit, expected, ["a", "b"]));
});
