import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

async function probe(source, rejected) {
  const root = mkdtempSync(join(tmpdir(), "default-timing-"))
  try {
    const file = join(root, "main.vibe"), compiler = join(root, "compiler.cjs")
    writeFileSync(file, source)
    writeFileSync(compiler, `#!/usr/bin/env node
${fakeProjectFiles(root)}
require("node:fs").writeFileSync("called", "fix")
console.log("vibelang --fix: 0 fixes in 0 files.")
`)
    chmodSync(compiler, 0o755)
    const action = () => fixToFixedPoint({ compiler, cwd: root, root, only: ["main.vibe"], tsconfig: "tsconfig.json", log: join(root, "fix"), onProgress: null })
    if (rejected) {
      await assert.rejects(action, /main\.vibe:\d+:\d+:.*Effect\.fn.*default.*execution/)
      assert.equal(existsSync(join(root, "called")), false, "refuse before the legacy fixer runs")
      const audit = readFileSync(join(root, "fix.scope.log"), "utf8")
      const record = audit.split("\n").filter(line => line.startsWith("{")).map(JSON.parse).find(row => row.stage === "default-argument-timing-refused")
      assert.ok(record?.sites.length)
      assert.deepEqual(Object.keys(record.sites[0]).sort(), ["column", "file", "line"])
      assert.equal(record.sites[0].file, "main.vibe")
    } else {
      assert.equal((await action()).settled, true)
      assert.equal(existsSync(join(root, "called")), true)
    }
    assert.equal(readFileSync(file, "utf8"), source)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const [name, parameters] of [
  ["module state", "value = state.value"],
  ["earlier parameter", "input: { branch: string }, value = input.branch"],
  ["dependent defaults", "first = ++counter, second = first + ++counter, third = second + ++counter"],
  ["side effect", "value = next()"],
  ["fresh object", "options: { seen?: number } = {}"],
  ["fresh array", "values: number[] = []"],
  ["Effect value", "value = Effect.succeed(++counter)"],
  ["pattern default", "{ value } = { value: ++counter }"],
  ["nested pattern default", "{ value = ++counter }: { value?: number }"],
]) {
  test("legacy migration refuses per-execution " + name, () => probe(
    'import * as Effect from "effect/Effect";\nexport const make = Effect.fn(function* (' + parameters + ') { return 1 });\n', true))
}
test("named and untraced generator wrappers retain the same guard", async () => {
  for (const callee of ['Effect.fn("make")', "Effect.fnUntraced", "E.fn", "E.fnUntraced", "fn", "untraced", 'Effect["fn"]']) {
    await probe('import * as E from "effect/Effect"; import { fn, fnUntraced as untraced } from "effect/Effect";\nconst make = ' + callee + '(function* (value = {}) { return value });', true)
  }
})
test("plain factories and generators without defaults still reach the fixer", async () => {
  await probe("export function make(value = {}) { return Effect.gen(function* () { return value }) }", false)
  await probe("export const make = Effect.fn(function* (value: number) { return value })", false)
  await probe('const text = "Effect.fn(function* (value = {}) {})";', false)
})
test("random counter defaults are refused before changing their call log", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 5 }), async weights => {
    const parameters = weights.map((weight, i) => "p" + i + " = (counter += " + weight + (i ? ", p" + (i - 1) + " + counter)" : ", counter)")).join(", ")
    await probe("let counter = 0; export const make = Effect.fnUntraced(function* (" + parameters + ") { return counter })", true)
  }), { numRuns: 30 })
})

test("minimized default patterns remain protected", async () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-effect-fn-defaults.json", import.meta.url), "utf8"))
  for (const source of Object.values(corpus)) await probe(source, true)
})

test("implicit factories and root Effect namespaces retain execution-time defaults", async () => {
  for (const source of [
    "export const make = fn(function* (value = {}) { return value })",
    "export const make = fnUntraced(function* (value = []) { return value })",
    'import * as Root from "effect"; export const make = Root.Effect.fn(function* (value = {}) { return value })',
    'import * as Root from "effect"; export const make = Root.Effect.fnUntraced(function* (value = []) { return value })',
  ]) await probe(source, true)
})
