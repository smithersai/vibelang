import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { repinVibeLang, patchState } from "../lib/upgrade.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const packages = ["vibelang", "vibelang-runtime", "vibelang-vite", "vibelang-unplugin"]
const fields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]

function checkRepin(input) {
  const before = { name: "fixture", scripts: { vibelang: input.old }, settings: { vibelang: input.old } }
  const expected = structuredClone(before)
  const specs = Object.fromEntries(input.specs.map((name) => [name, "file:./.vibelang-toolchain/" + name + "-0.0.11-a1b2c3d4e5f6.tgz"]))
  const found = []
  for (const field of input.fields) {
    before[field] = { effect: "4.0.6", "vibelang-extra": input.old }
    expected[field] = { ...before[field] }
    for (const name of input.packages) {
      before[field][name] = input.old
      expected[field][name] = specs[name] ?? input.old
      found.push(name)
    }
  }
  const text = JSON.stringify(before, null, input.indent) + "\n"
  const result = repinVibeLang(text, specs)
  assert.deepEqual(JSON.parse(result.text), expected)
  assert.equal(result.text, JSON.stringify(expected, null, input.indent) + "\n")
  assert.deepEqual(result.found.sort(), found.sort())
  assert.equal(repinVibeLang(result.text, specs).text, result.text)
}
test("smithers: every staged VibeLang adapter repins with the compiler and runtime", () => {
  const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  for (const name of packages) assert.ok(contract.includes(name), "setup contract lost " + name)
  const fixture = JSON.parse(readFileSync(new URL("./corpus/smithers-repin-unplugin.json", import.meta.url), "utf8"))
  checkRepin(fixture.input)
  fc.assert(fc.property(fc.record({
    fields: fc.subarray(fields, { minLength: 1 }),
    packages: fc.subarray(packages, { minLength: 1 }),
    specs: fc.subarray(packages, { minLength: 1 }),
    old: fc.constantFrom("0.0.8", "^0.0.10", "~0.0.9", "file:../previous.tgz"),
    indent: fc.constantFrom(0, 2, "\t")
  }), checkRepin), { seed: 110011, numRuns: 350 })
})

function patch(file, before, after) {
  const removed = before.length ? before.split("\n") : []
  const added = after.length ? after.split("\n") : []
  return [
    "diff --git a/" + file + " b/" + file,
    "--- " + (before.length ? "a/" + file : "/dev/null"),
    "+++ b/" + file,
    "@@ -" + (removed.length ? "1," + removed.length : "0,0") + " +1," + added.length + " @@",
    ...removed.map((line) => "-" + line),
    ...added.map((line) => "+" + line),
    ""
  ].join("\n")
}
function checkPatch(input) {
  const old = "export const before" + input.id + " = " + input.value + ";"
  const next = "export const after" + input.id + " = " + (input.value + 1) + ";"
  const file = input.directory + "/register.mjs"
  const comment = "// " + input.comment
  const text = patch(file, comment + "\n" + old, comment + "\n" + next)
  assert.equal(patchState(text, (path) => path === file ? comment + "\n" + old + "\n" : undefined), "applies")
  assert.equal(patchState(text, (path) => path === file ? "// release words it differently\n" + next + "\n" : undefined), "contained")
  assert.equal(patchState(text, () => "export const unrelated = true;\n"), "conflict")
  const addition = patch(file, "", next)
  assert.equal(patchState(addition, () => undefined), "applies")
  assert.equal(patchState(addition, () => next + "\n"), "contained")
}
test("smithers: patch classification distinguishes a contained change, an applicable patch and an unrelated release", () => {
  const fixture = JSON.parse(readFileSync(new URL("./corpus/smithers-contained-vibelang-patch.json", import.meta.url), "utf8"))
  assert.equal(patchState(fixture.patch, (path) => path === fixture.file ? fixture.before : undefined), "applies")
  assert.equal(patchState(fixture.patch, (path) => path === fixture.file ? fixture.after : undefined), "contained")
  fc.assert(fc.property(fc.record({
    id: fc.integer({ min: 0, max: 999 }),
    value: fc.integer({ min: -1000, max: 1000 }),
    directory: fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/), { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/")),
    comment: fc.constantFrom("old patch", "header with --- and +++", "another comment")
  }), checkPatch), { seed: 800011, numRuns: 350 })
})
