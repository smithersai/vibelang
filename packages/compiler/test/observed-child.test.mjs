import assert from "node:assert/strict"
import { test } from "node:test"
import { observedChild } from "./observed-child.mjs"

function run(script, extra = {}) {
  const lines = []
  const options = { encoding: "utf8", timeout: 2000, ...extra }
  const result = observedChild(process.execPath, ["-e", script], options, "revision=2 bun cached", line => lines.push(line))
  assert.equal(lines.length, 2)
  assert.equal(lines[0], 'child revision=2 bun cached started {"timeoutMs":2000}')
  const prefix = "child revision=2 bun cached finished "
  assert.ok(lines[1].startsWith(prefix))
  const record = JSON.parse(lines[1].slice(prefix.length))
  assert.ok(Number.isInteger(record.elapsedMs) && record.elapsedMs >= 0)
  assert.equal(record.status, result.status)
  assert.equal(record.signal, result.signal)
  assert.equal(record.error, result.error?.code ?? null)
  return { result, record }
}

test("successful child keeps both exact pipes and return status", () => {
  const { result, record } = run('process.stdout.write("漢字"); process.stderr.write("note")')
  assert.equal(result.status, 0)
  assert.equal(record.stdout, "漢字")
  assert.equal(record.stderr, "note")
})

test("nonzero and signal exits keep the termination reason and partial output", () => {
  const failed = run('process.stdout.write("before failure"); process.stderr.write("assertion"); process.exitCode = 7')
  assert.equal(failed.record.status, 7)
  assert.equal(failed.record.stdout, "before failure")
  assert.equal(failed.record.stderr, "assertion")
  const signaled = run('process.stderr.write("before signal"); process.kill(process.pid, "SIGTERM")')
  assert.equal(signaled.record.signal, "SIGTERM")
  assert.equal(signaled.record.stderr, "before signal")
})

test("a timed-out real child retains stage, partial output, signal and error code", () => {
  const { result, record } = run('process.stdout.write("compiler started"); process.stderr.write("waiting on preload"); setInterval(() => {}, 1000)')
  assert.equal(result.error.code, "ETIMEDOUT")
  assert.equal(record.error, "ETIMEDOUT")
  assert.equal(record.signal, "SIGTERM")
  assert.equal(record.stdout, "compiler started")
  assert.equal(record.stderr, "waiting on preload")
})

test("an unavailable executable still records the failed stage", () => {
  const lines = []
  const result = observedChild("/vibelang-test-no-such-executable", [], { encoding: "utf8", timeout: 2000 }, "revision=0 node fresh", line => lines.push(line))
  assert.equal(result.error.code, "ENOENT")
  assert.match(lines[0], /^child revision=0 node fresh started /)
  const record = JSON.parse(lines[1].split(" finished ")[1])
  assert.equal(record.error, "ENOENT")
  assert.equal(record.status, null)
})

test("large stdout and stderr have independent tails while the result stays intact", () => {
  const { result, record } = run('process.stdout.write("x".repeat(9000) + "output-end"); process.stderr.write("y".repeat(9000) + "error-end")')
  assert.equal(result.stdout.length, 9010)
  assert.equal(result.stderr.length, 9009)
  assert.equal(record.stdout.length, 4000)
  assert.equal(record.stderr.length, 4000)
  assert.ok(record.stdout.endsWith("output-end"))
  assert.ok(record.stderr.endsWith("error-end"))
})

test("generated Unicode and escaped output survives real child diagnostics", async () => {
  const { default: fc } = await import("fast-check")
  const { checkProperty } = await import("../../../scripts/testing/property.mjs")
  const text = fc.array(fc.constantFrom("a", "漢", "🙂", "\n", '"', "\\", "\0"), { maxLength: 50 }).map(xs => xs.join(""))
  await checkProperty(fc, {
    name: "observed-child-output",
    rule: "docs/maintainers/build.md: loader child records retain engine/cache/revision, termination metadata and bounded partial output",
    command: "node --test test/observed-child.test.mjs",
    arbitrary: fc.record({ stdout: text, stderr: text }),
    numRuns: 20,
    check: ({ stdout, stderr }) => {
      const actual = run("process.stdout.write(" + JSON.stringify(stdout) + "); process.stderr.write(" + JSON.stringify(stderr) + ")")
      assert.equal(actual.record.stdout, stdout)
      assert.equal(actual.record.stderr, stderr)
      assert.equal(actual.result.status, 0)
    }
  })
})
