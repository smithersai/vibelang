import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { test } from "node:test"
import { checkProperty } from "./testing/property.mjs"

const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const scaleTests = fileURLToPath(new URL("./api-identity-scale.test.mjs", import.meta.url))
const selected = "independent generic entry points fit a bounded heap|input checker state is released before validating generic bridges|dependency diagnostic batches release unrelated generic instantiations"

function runChildResult(result) {
  const root = mkdtempSync(join(tmpdir(), "api-scale-child-result-"))
  try {
    const hook = join(root, "child-result.cjs")
    writeFileSync(hook, `
const cp = require("node:child_process");
const original = cp.spawnSync;
cp.spawnSync = (command, args, options) => {
  if (!args?.some(arg => arg.startsWith("--max-old-space-size="))) return original(command, args, options);
  const result = ${JSON.stringify(result)};
  if (result.error) result.error = Object.assign(new Error(result.error.message), result.error);
  return { pid: 123, output: [null, result.stdout, result.stderr], ...result };
};
require("node:module").syncBuiltinESMExports();
`)
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawnSync(process.execPath, ["--require", hook, "--test", "--test-name-pattern", selected, scaleTests], {
      encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024, env,
    })
    assert.equal(child.error, undefined, String(child.error))
    assert.equal(child.signal, null)
    return { status: child.status, output: child.stdout + child.stderr }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("API scale deadlines retain the process cause, budgets and last comparator stage", () => {
  const child = runChildResult({
    status: null, signal: "SIGTERM", stdout: "",
    stderr: '{"stage":"input-diagnostics","entryOffset":8,"heapUsed":123456}\n',
    error: { name: "Error", code: "ETIMEDOUT", message: "operation deadline expired" },
  })
  assert.equal(child.status, 1)
  for (const value of ["ETIMEDOUT", "SIGTERM", "operation deadline expired", "input-diagnostics", "entryOffset", "heapUsed",
    "timeoutMs", "120000", "180000", "elapsedMs", "heapLimitMiB"]) assert.ok(child.output.includes(value), `missing ${value}: ${child.output}`)
})

test("API scale success still checks the complete identity receipt", () => {
  for (const complete of [true, false]) {
    const child = runChildResult({ status: 0, signal: null,
      stdout: JSON.stringify({ identical: true, comparisonComplete: complete,
        environmentDiagnostics: [{ blocking: false, diagnostic: "TS2344" }] }), stderr: "" })
    assert.equal(child.status, complete ? 0 : 1, child.output)
  }
})

test("API scale process failures retain generated exit, signal and error causes", async () => {
  await checkProperty(fc, {
    name: "api-identity-scale-child-failures",
    rule: "Every bounded API scale subprocess must exit successfully; a failure preserves its process cause and comparison diagnostics.",
    command: "node --test scripts/api-identity-scale-failures.test.mjs",
    numRuns: 8,
    arbitrary: fc.oneof(
      fc.integer({ min: 1, max: 127 }).map(status => ({ status, signal: null, marker: String(status) })),
      fc.constantFrom("SIGTERM", "SIGKILL", "SIGABRT").map(signal => ({ status: null, signal, marker: signal })),
      fc.constantFrom("ETIMEDOUT", "ENOBUFS", "ENOENT").map(code => ({
        status: null, signal: null, error: { name: "Error", code, message: "child process refused" }, marker: code,
      })),
    ),
    check: ({ marker, ...result }) => {
      const child = runChildResult({ ...result, stdout: "partial-result", stderr: "last-comparator-stage" })
      assert.equal(child.status, 1)
      for (const value of [marker, "partial-result", "last-comparator-stage"]) assert.ok(child.output.includes(value), `missing ${value}: ${child.output}`)
    },
  })
})
