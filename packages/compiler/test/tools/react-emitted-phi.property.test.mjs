import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { transform } from "oxc-transform-react"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { compilerPackage, hooks, project } from "./helpers.mjs"

const { toolArguments } = await import(join(compilerPackage, "emit.mjs"))
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/t3code-react-phi-operand.json", import.meta.url), "utf8"))
const options = { jsx: { runtime: "automatic", development: false, refresh: false }, reactCompiler: { reportDiagnostics: true } }
const quote = "Every tool is tested against the dogfood repositories."
test("the implementation tool oracle quotes the existing-tools contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

async function check(t, mutation) {
  let source = fixture.files["src/main.vibe"]
  for (const name of ["imageIndex", "handoffUrl", "timelineAttachmentUrlById"]) {
    source = source.replace(new RegExp("\\b" + name + "\\b", "g"), name + mutation.suffix)
  }
  if (mutation.guard) source = source.replace("handoffUrls === undefined", 'typeof handoffUrls === "undefined"')
  if (mutation.comments) source = source.replace("const timelineAttachmentUrlById", "/* retained control flow */ const timelineAttachmentUrlById")
  const root = project(t, { ...fixture.files, "src/main.vibe": source })
  const file = join(root, "src/main.vibe")
  const native = await transform(file.replace(/\.vibe$/, ".ts"), source.replace(/:\s*infer\s+_/g, ""), options)
  assert.deepEqual(native.errors.map(error => error.message), [], "the untouched TypeScript control must pass the real React Compiler")
  const emitted = toolArguments(file, source, options)
  assert.notEqual(emitted[1], source, "the real adapter must supply emitted JavaScript")
  assert.equal(emitted[2].lang, "jsx")
  const actual = await transform(...emitted)
  const messages = actual.errors.map(error => error.message)
  assert.deepEqual(messages, [], fixture.key + ": emitted implementation must pass the unchanged React Compiler")
}

test(fixture.key, async t => check(t, { suffix: "", guard: false, comments: false }))
test("emission and React checking vary local names, guard spelling and retained comments", async t => {
  await fc.assert(fc.asyncProperty(fc.record({
    suffix: fc.integer({ min: 0, max: 9 }).map(String), guard: fc.boolean(), comments: fc.boolean(),
  }), mutation => check(t, mutation)), { seed: 731018, numRuns: 12, endOnFailure: true })
})
test("the real adapter still optimizes the existing clean-hook control", async t => {
  const root = project(t, hooks, ["react", "@types/react"])
  const file = join(root, "src/useLabel.vibe")
  const actual = await transform(...toolArguments(file, hooks["src/useLabel.vibe"], options))
  const native = await transform(file.replace(/\.vibe$/, ".ts"), hooks["src/useLabel.vibe"], options)
  assert.deepEqual(actual.errors.map(error => error.message), [])
  assert.deepEqual(native.errors.map(error => error.message), [])
  assert.equal(actual.code, native.code)
})
