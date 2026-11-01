import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

function fixture(t, fields = {}) {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-known-failure-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, "witness.json"), JSON.stringify({
    property: "known-witness", input: 9, knownFailure: true,
    rule: "test harness: only the recorded defect is an expected failure",
    errorPattern: "^Error: expected witness defect\\b", ...fields
  }))
  return {
    name: "known-witness", rule: "test harness", command: "node --test",
    regressions: pathToFileURL(directory + "/"),
    arbitrary: fc.constant(0), numRuns: 1, env: {}
  }
}

test("a known regression accepts the matching failure and continues discovery", async t => {
  const options = fixture(t)
  const seen = []
  await checkProperty(fc, { ...options, check: input => {
    seen.push(input)
    if (input === 9) throw new Error("expected witness defect: stable detail")
  } })
  assert.deepEqual(seen, [9, 0])
})

test("a repaired known regression still fails with XPASS", async t => {
  await assert.rejects(checkProperty(fc, { ...fixture(t), check: () => {} }), /XPASS witness.json/)
})

for (const failure of [
  Object.assign(new Error("fixture compiler missing"), { code: "ENOENT" }),
  Object.assign(new Error("fixture permission denied"), { code: "EACCES" }),
  Object.assign(new Error("fixture transport disconnected"), { code: "ECONNRESET" }),
  new Error("expected different defect"),
  new assert.AssertionError({ actual: 1, expected: 0, operator: "strictEqual", message: "unrelated compiler result" }),
  "unrelated thrown string", 0, null, undefined
]) {
  test("a known regression rejects a different cause: " + String(failure), async t => {
    const options = fixture(t)
    let discovered = false
    await assert.rejects(checkProperty(fc, { ...options, check: input => {
      if (input === 9) throw failure
      discovered = true
    } }), error => {
      assert.match(error.message, /witness.json/)
      assert.match(error.message, /unexpected failure/i)
      assert.match(error.message, /expected witness defect/)
      assert.equal(error.cause, failure)
      return true
    })
    assert.equal(discovered, false, "discovery ran after an unexpected regression failure")
  })
}

for (const errorPattern of [undefined, null, 7, "", " ", "["]) {
  test("known regression metadata fails before execution: " + JSON.stringify(errorPattern), async t => {
    let ran = false
    await assert.rejects(checkProperty(fc, { ...fixture(t, { errorPattern }), check: () => {
      ran = true
      throw new Error("would otherwise be swallowed")
    } }), /witness.json.*errorPattern/)
    assert.equal(ran, false)
  })
}

test("unselected properties do not validate or run another property's known gap", async t => {
  const options = fixture(t, { property: "other", errorPattern: "[" })
  let runs = 0
  await checkProperty(fc, { ...options, check: input => { assert.equal(input, 0); runs++ } })
  assert.equal(runs, 1)
})

test("ordinary saved regressions need no expected-error pattern", async t => {
  const options = fixture(t, { knownFailure: false, errorPattern: undefined })
  const seen = []
  await checkProperty(fc, { ...options, check: input => { seen.push(input) } })
  assert.deepEqual(seen, [9, 0])
})

test("matching an assertion's recorded diagnostic retains the known gap", async t => {
  const options = fixture(t, { errorPattern: "stock refusal[\\s\\S]*EK9001" })
  await checkProperty(fc, { ...options, check: input => {
    if (input === 9) assert.match("error EK9001: recorded diagnostic", /EK9100/, "stock refusal")
  } })
})

test("generated unrelated tool errors cannot satisfy a recorded diagnostic", async t => {
  const options = fixture(t, { errorPattern: "^Error: expected witness defect$" })
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("ENOENT", "EACCES", "ECONNRESET", "ETIMEDOUT", "EIO"),
    fc.string({ minLength: 0, maxLength: 30 }),
    async (code, suffix) => {
      const failure = Object.assign(new Error(code + ": " + suffix), { code })
      await assert.rejects(checkProperty(fc, { ...options, check: input => {
        if (input === 9) throw failure
      } }), error => error.cause === failure && /unexpected failure/i.test(error.message))
    }
  ), { numRuns: 50, seed: 20261101 })
})
