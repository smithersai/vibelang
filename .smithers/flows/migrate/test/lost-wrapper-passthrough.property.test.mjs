import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { lostWrappers } from "../lib/lost-wrapper.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-wrapper-passthrough-stage.json", import.meta.url)))
const prefix = 'import * as Effect from "effect/Effect";\n'
const factory = expression => 'export const factory = (on = true) => { if (!on) return Effect.succeed(null); return ' + expression + '; };\n'
const original = prefix + "const through = program => program;\n" + factory("Effect.succeed(1).pipe(program => through(program))")
const scan = emitted => lostWrappers({ ts, original, emitted: prefix + emitted })

test("passthrough corpus quotes the preservation contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
})
test("T3 Code a plain identity pipeline stage retains the returned Effect", () => {
  const result = scan("const through = program => program;\n" + factory("((program) => through(program))(Effect.succeed(1))"))
  assert.deepEqual(result.flags, [], JSON.stringify(result))
  assert.deepEqual(result.unpaired, [])
})
test("a directly returned IIFE parameter retains its Effect argument", () => {
  assert.deepEqual(scan("const through = program => program;\n" + factory("((program) => program)(Effect.succeed(1))")).flags, [])
})
test("opaque, shadowed, async and mutated passthrough stages never prove a retained wrapper", () => {
  for (const [helper, stage, parameter] of [
    ["const through = program => 0;", "(program) => through(program)", ""],
    ["let through = program => program;", "(program) => through(program)", ""],
    ["const through = async program => program;", "(program) => through(program)", ""],
    ["const through = function* (program) { return program };", "(program) => through(program)", ""],
    ["const through = program => program;", "function* (program) { return program }", ""],
    ["const through = (program = 0) => program;", "(program) => through(program)", ""],
    ["const through = (...program) => program[0];", "(program) => through(program)", ""],
    ["const through = program => program;", "(program) => { program = 0; return through(program) }", ""],
    ["const through = program => program;", "async (program) => through(program)", ""],
    ["const through = program => program;", "(program) => { const through = value => 0; return through(program) }", ""],
    ["const through = program => program;", "(program) => through(program)", ", through = value => 0"],
    ["const { through } = unknown;", "(program) => through(program)", ""],
    ["const through = program => through(program);", "(program) => through(program)", ""]
  ]) {
    const emitted = helper + "\n" + factory("(" + stage + ")(Effect.succeed(1))").replace("(on = true)", "(on = true" + parameter + ")")
    const result = scan(emitted)
    assert.ok(result.flags.some(f => f.function === "/factory"), emitted + "\n" + JSON.stringify(result))
  }
})
test("a non-Effect argument still loses the wrapper through an identity stage", () => {
  const result = scan("const through = program => program;\n" + factory("((program) => through(program))(1)"))
  assert.ok(result.flags.some(f => f.function === "/factory"))
})
test("property: identity stages preserve program evidence and never invent it for bare values", async () => {
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote, numRuns: 100,
    command: "node --test .smithers/flows/migrate/test/lost-wrapper-passthrough.property.test.mjs",
    arbitrary: fc.record({ name: fc.constantFrom("p", "program", "value", "$program"), block: fc.boolean(),
      local: fc.boolean(), depth: fc.integer({ min: 1, max: 3 }), lost: fc.boolean() }),
    check: ({ name, block, local, depth, lost }) => {
      const helper = "const through = " + name + " => " + (block ? "{ return " + name + "; }" : name) + ";\n"
      let expression = lost ? "1" : "Effect.succeed(1)"
      for (let i = 0; i < depth; i++) expression = "((" + name + ") => through(" + name + "))(" + expression + ")"
      let emitted = local ? factory(expression).replace("{ if (!on)", "{ " + helper + "if (!on)") : helper + factory(expression)
      const result = scan(emitted)
      assert.equal(result.flags.some(f => f.function === "/factory"), lost, emitted + "\n" + JSON.stringify(result))
    }
  })
})
