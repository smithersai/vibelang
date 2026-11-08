import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { lostWrappers } from "../lib/lost-wrapper.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const runtimeRequire = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const Effect = runtimeRequire("effect/Effect")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-wrapper-passthrough-stage.json", import.meta.url)))
const discarded = JSON.parse(readFileSync(new URL("./corpus/t3code-wrapper-discarded-argument.json", import.meta.url)))
const prefix = 'import * as Effect from "effect/Effect";\n'
const factory = expression => 'export const factory = (on = true) => { if (!on) return Effect.succeed(null); return ' + expression + '; };\n'
const original = prefix + "const through = program => program;\n" + factory("Effect.succeed(1).pipe(program => through(program))")
const scan = emitted => lostWrappers({ ts, original, emitted: prefix + emitted })

test("passthrough corpus quotes the preservation contract", () => {
  const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
  for (const quote of [corpus.quote, discarded.rule]) assert.ok(chapter.includes(quote))
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


// Execute the generated JavaScript with the real Effect runtime: the oracle
// observes what the callback returns independently of the source scanner.
test("property: discarded inline arguments never count as returned programs", async () => {
  await checkProperty(fc, {
    name: discarded.property, rule: discarded.rule, numRuns: 240,
    regressions: new URL("./corpus/", import.meta.url),
    command: "node --test .smithers/flows/migrate/test/lost-wrapper-passthrough.property.test.mjs",
    arbitrary: fc.record({
      name: fc.constantFrom("p", "program", "value", "$program"),
      kind: fc.constantFrom("identity", "drop-helper", "shadow-local", "shadow-parameter",
        "assign", "destructure", "increment", "nested-write", "for-of", "for-in", "drop-result"),
      alias: fc.boolean(), depth: fc.integer({ min: 1, max: 3 }),
    }),
    check: ({ name, kind, alias, depth }) => {
      const helper = "const through = input => " + (kind === "drop-helper" ? "0" : "input") + ";\n"
      const mutation = {
        assign: name + " = 0;",
        destructure: "[" + name + "] = [0];",
        increment: name + "++;",
        "nested-write": "(() => { " + name + " = 0; })();",
        "for-of": "for (" + name + " of [0]) {}",
        "for-in": "for (" + name + " in { lost: 0 }) {}",
        "shadow-local": "const through = input => 0;",
      }[kind] ?? ""
      const returned = kind === "drop-result" ? name + ".missing" : "through(" + name + ")"
      const body = mutation + (alias ? "const kept = " + returned + "; return kept;" : "return " + returned + ";")
      let expression = "((" + name + ") => { " + body + " })(Effect.succeed(1))"
      for (let i = 1; i < depth; i++) expression = "((kept) => kept)(" + expression + ")"
      let emitted = helper + factory(expression)
      if (kind === "shadow-parameter") emitted = emitted.replace("(on = true)", "(on = true, through = input => 0)")
      const source = emitted.replace("export const factory", "const factory")
      const actual = Function("Effect", source + "\nreturn factory;")(Effect)
      assert.equal(Effect.isEffect(actual(false)), true, emitted)
      assert.equal(Effect.isEffect(actual()), kind === "identity", emitted)
      const result = scan(emitted)
      assert.equal(result.flags.some(f => f.function === "/factory"), kind !== "identity", emitted + "\n" + JSON.stringify(result))
    }
  })
})
