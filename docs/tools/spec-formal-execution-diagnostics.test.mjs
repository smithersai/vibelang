import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repo, run, block } from "./spec-witness.mjs"

const root = process.env.SPEC_FORMAL_DIAGNOSTICS_ROOT ?? repo
const read = path => readFileSync(resolve(root, path), "utf8")
const chapter = name => read("docs/design/src/" + name + ".md")

test("EK0102 includes direct formal initialization without making it Effect code", () => {
  for (const name of ["001-functions", "900-appendices"]) {
    const row = chapter(name).split("\n").find(line => line.includes("| `EK0102` |") || line.endsWith("| `EK0102` |"))
    assert.ok(row?.includes("formal-parameter initialization"), name + " must inventory the parameter rejection")
  }
  assert.ok(chapter("001-functions").includes("does not make parameter initialization effect code"))
  assert.ok(read("docs/design/vips/0001-effect-and-async-functions.md").includes("formal-parameter initialization"))
})

test("EK2104 covers parameters of all Effect callables, including producers", () => {
  for (const name of ["002-running", "900-appendices"]) {
    const row = chapter(name).split("\n").find(line => line.includes("| `EK2104` |") || line.endsWith("| `EK2104` |"))
    assert.ok(row?.includes("formal-parameter initialization"), name + " must include parameters")
    assert.ok(row?.includes("producer"), name + " must not exempt producer parameters")
  }
  assert.ok(read("docs/design/vips/0021-producers.md").includes("formal-parameter initialization"))
})

test("parameter rules retain nested source boundaries and the separate try diagnostic", () => {
  const text = chapter("001-functions")
  assert.ok(text.includes("nested source callable or context boundary"), "source boundaries limit the check")
  assert.ok(text.includes("try` keeps `EK0501"), "try retains its outside-Effect rule")
  const running = chapter("002-running")
  for (const form of ["badParameterAwait", "badParameterYield", "badParameterTry"]) assert.ok(running.includes(form), form)
})

test("native async and generator parameter initialization cannot suspend", async () => {
  for (const source of [
    "async function f(x = await p) {}",
    "const f = async function (x = await p) {}",
    "const o = { async f(x = await p) {} }",
    "async function* f(x = await p) {}",
    "class C { async *f(x = await p) {} }",
    "const f = async (x = await p) => 0",
    "class C { async f(x = await p) {} }",
    "async function f({x = await p} = {}) {}",
    "async function f({[await p]: x} = {}) {}",
    "function* f(x = yield 1) {}",
    "async function* f(x = yield 1) {}",
    "const f = async function* (x = yield 1) {}",
    "const o = { *f(x = yield 1) {} }",
    "class C { *f(x = yield 1) {} }",
    "function* f({x = yield 1} = {}) {}"
  ]) assert.throws(() => new Function('"use strict"; ' + source), SyntaxError, source)
  const result = await new Function('"use strict"; async function f(make = function* () { yield 7 }, later = async () => await Promise.resolve(8)) { return [make().next().value, await later()] }; return f()')()
  assert.deepEqual(result, [7, 8])
})

test("the printed admitted parameter boundary gives the stated Effect Exit", () => {
  const source = block(chapter("002-running"), "function parameterBoundaryWitness", "ts effect")
  const result = run(source + '\nconsole.log(JSON.stringify(Effect.runSyncExit(parameterBoundaryWitness())))\n')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), { _id: "Exit", _tag: "Success", value: 0 })
})


test("formal-boundary additions retain the body rules cited by current fuzz programs", () => {
  for (const [file, name, select] of [
    ["functions_spec_fuzz_test.go", "001-functions", key => ["await", "await-using", "for-await"].includes(key)],
    ["running_rules_fuzz_test.go", "002-running", key => key.startsWith("producer-") && key.includes("yield")]
  ]) {
    const source = read("typescript/tsc/internal/vibelangfuzz/" + file)
    let checked = 0
    for (const entry of source.matchAll(/^\s*\{"([^"\\]+)",\s*("(?:\\.|[^"\\])*")/gm)) {
      if (!select(entry[1])) continue
      checked++
      const quote = JSON.parse(entry[2])
      assert.ok(chapter(name).includes(quote), file + ":" + entry[1] + " no longer quotes its body rule")
    }
    assert.ok(checked > 0, file + " must expose body-rule references")
  }
})
