import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fixProgressStream } from "../lib/fix-progress.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-fix-progress.json", import.meta.url)))

test("alchemy: native fix progress retains counters across arbitrary stream chunks", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 37 }), { minLength: 1, maxLength: 20 }), fc.boolean(), fc.boolean(), (sizes, crlf, terminate) => {
    const line = corpus.line + (terminate ? crlf ? "\r\n" : "\n" : "")
    const source = Buffer.from("opaque child text\n" + line), events = [], stream = fixProgressStream(event => events.push(event))
    let index = 0, at = 0
    while (at < source.length) { const end = Math.min(source.length, at + sizes[index++ % sizes.length]); stream.write(source.subarray(at, end)); at = end }
    stream.end()
    assert.deepEqual(events, [corpus.expected])
    assert.equal(JSON.stringify(events).includes("opaque"), false)
  }), { seed: 211304, numRuns: 240 })
})

test("all native phases report counters without retaining activity or diagnostics", () => {
  for (const phase of ["start", "legacy readonly source upgrade", "round", "try", "prelude", "imports", "directives"]) {
    const events = [], stream = fixProgressStream(event => events.push(event))
    stream.write(Buffer.from(`vibelang --fix: 1µs: ${phase}: 1 fix applied, 0 pending; 1 check, 1 this phase (1 whole, 0 partial); opaque activity for 1s\n`))
    stream.end()
    assert.deepEqual(events, [{ elapsed: "1µs", phase, round: 0, applied: 1, pending: 0, refused: 0, checks: 1, phaseChecks: 1, whole: 1, partial: 0 }])
  }
})

test("oversized and malformed child text cannot become a progress record", () => {
  const events = [], stream = fixProgressStream(event => events.push(event))
  stream.write(Buffer.from("x".repeat(20000)))
  stream.write(Buffer.from(corpus.line + "\n"))
  stream.write(Buffer.from(corpus.line.replace("round 3", "opaque activity") + "\n"))
  stream.write(Buffer.from(corpus.line.replace("41 fixes", "999999999999999999999 fixes") + "\n"))
  stream.write(Buffer.from(corpus.line + "\n"))
  stream.end()
  assert.deepEqual(events, [corpus.expected])
})
