import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { markPlainFunctions } from "../lib/plain.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-plain-noop.json", import.meta.url), "utf8"))

// VIP-1 and decided detail 269: no legacy annotation is needed once the
// selected compiler proves that an unmodified function stays plain by syntax.
function fixture(files, action) {
  const root = mkdtempSync(join(tmpdir(), "plain-noop-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { types: [], noLib: true }, include: ["src/**/*.ts"] }))
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    return action(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("plain-by-syntax skips the native program for the opencode helper corpus", () => {
  fixture(corpus.files, root => {
    let programs = 0
    const instrumented = { ...ts, createProgram(...args) { programs++; return ts.createProgram(...args) } }
    const result = markPlainFunctions(instrumented, root, Object.keys(corpus.files), ["tsconfig.json"], { flipped: true })
    assert.deepEqual(result, {})
    for (const [file, text] of Object.entries(corpus.files)) assert.equal(readFileSync(join(root, file), "utf8"), text)
    assert.equal(programs, 0, "a no-op must not construct or typecheck the selected package graph")
  })
})

test("plain-by-syntax does not read an unavailable project's dependency graph", () => {
  const unavailable = new Proxy({}, { get(_target, name) { throw new Error("unnecessary TypeScript access: " + String(name)) } })
  assert.deepEqual(markPlainFunctions(unavailable, ".", ["src/input.ts"], ["not-installed/tsconfig.json"], { flipped: true }), {})
})

test("property: generated native helper batches remain byte-identical without compiler or overlay access", () => {
  const unavailable = new Proxy({}, { get() { assert.fail("plain syntax needs no TypeScript service") } })
  const noOverlay = () => assert.fail("the no-op cannot inspect or rewrite the journal overlay")
  fc.assert(fc.property(fc.array(fc.record({
    form: fc.constantFrom("arrow", "function", "generator", "async"),
    value: fc.integer({ min: -100, max: 100 }),
  }), { minLength: 1, maxLength: 24 }), rows => {
    const files = Object.fromEntries(rows.map(({ form, value }, i) => {
      const bodies = {
        arrow: "export const f = () => " + value,
        function: "export function f() { return " + value + " }",
        generator: "export function* f() { yield " + value + " }",
        async: "export async function f() { return " + value + " }",
      }
      return ["src/helper" + i + ".ts", bodies[form] + "\n"]
    }))
    fixture(files, root => {
      assert.deepEqual(markPlainFunctions(unavailable, root, Object.keys(files), ["tsconfig.json"], { flipped: true, read: noOverlay, write: noOverlay, exists: noOverlay }), {})
      for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(root, file), "utf8"), text)
    })
  }), { seed: 269, numRuns: 60 })
})
