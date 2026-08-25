/**
 * A `node --test` reporter that emits one JSON record per finished test.
 *
 * This exists for the same reason `go test -json` exists for the Go gate: a
 * human-readable test report cannot be audited. `node --test` scores a skipped
 * test as a passing test and exits 0, so a gate that reads only the exit code
 * cannot tell "the suite ran and was green" apart from "the suite decided not
 * to run and was green anyway" — the failure mode this repository has now hit
 * three times. The records below carry the one fact the exit code loses: which
 * tests were skipped or marked todo, in which file, and why.
 *
 * It is a reporter rather than a TAP parse because the TAP `# SKIP` directive
 * is a suffix on a free-form test name, and because TAP does not attribute a
 * test to its file. `scripts/node-test-gate.mjs` runs this alongside the human
 * reporter, so the console output is unchanged.
 */
export default async function* nodeTestCensusReporter(source) {
  for await (const event of source) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const data = event.data ?? {};
    yield `${JSON.stringify({
      status: event.type === "test:pass" ? "pass" : "fail",
      name: typeof data.name === "string" ? data.name : "<unnamed test>",
      file: typeof data.file === "string" ? data.file : null,
      nesting: Number.isInteger(data.nesting) ? data.nesting : 0,
      // node reports `true` for a bare `{ skip: true }` and the reason string
      // for `{ skip: "why" }` or `t.skip("why")`. Both are skips; only the
      // second can be audited, which is itself worth reporting.
      skip: data.skip === undefined ? null : data.skip,
      todo: data.todo === undefined ? null : data.todo,
    })}\n`;
  }
}
