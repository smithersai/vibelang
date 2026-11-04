import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const runtime = join(repo, "packages/runtime")
const require = createRequire(new URL("../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const tsc = require.resolve("typescript/bin/tsc")
const rule = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-annotated-generator-stages.json", import.meta.url), "utf8"))

function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "annotated-generator-stages-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(join(runtime, "node_modules/effect")), join(root, "node_modules/effect"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    const options = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], declaration: true, outDir: "out" }
    const form = { named: 'Effect.fn("load")', plain: "Effect.fn", untraced: "Effect.fnUntraced" }[input.form]
    const value = input.nested ? 'yield* Effect.gen(function* () { return x })' : "x"
    const stage = input.mapped ? "Effect.map(value => String(value))" : 'Effect.withSpan("post")'
    const source = 'import { Effect } from "effect";\nexport let runs = 0;\nexport const load = ' + form +
      '(function* <T>(x: T): Effect.fn.Return<T> {\n yield* Effect.sync(() => { runs++; });\n const value = ' + value +
      ';\n /* retain return context */ return value;\n}, ' + stage + ');\n'
    const invoke = (binary, args) => {
      const result = spawnSync(binary, args, { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout
    }
    const config = file => writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: [file] }))
    const observe = () => JSON.parse(invoke(process.execPath, ["--input-type=module", "-e",
      'import {Effect} from "effect"; import * as m from "./out/main.js"; const before=m.runs; const p=m.load(' + input.value +
      '); const construction=m.runs; const values=[Effect.runSync(p),Effect.runSync(p)]; console.log(JSON.stringify({before,construction,values,runs:m.runs}));']))
    writeFileSync(join(root, "main.ts"), source)
    config("main.ts")
    invoke(process.execPath, [tsc, "-p", "tsconfig.json"])
    const declaration = readFileSync(join(root, "out/main.d.ts"), "utf8")
    const original = observe()
    assert.deepEqual(original, { before: 0, construction: 0, values: [input.mapped ? String(input.value) : input.value, input.mapped ? String(input.value) : input.value], runs: 2 })
    rmSync(join(root, "main.ts"))
    writeFileSync(join(root, "main.vibe"), source)
    config("main.vibe")
    invoke(native, ["-p", "tsconfig.json", "--pretty", "false", "--fix"])
    const fixed = readFileSync(join(root, "main.vibe"), "utf8")
    assert.doesNotMatch(fixed, /function\*|yield\*/, fixed)
    assert.ok(fixed.includes("/* retain return context */"), fixed)
    rmSync(join(root, "out"), { recursive: true, force: true })
    invoke(native, ["-p", "tsconfig.json", "--pretty", "false"])
    assert.equal(readFileSync(join(root, "out/main.d.ts"), "utf8"), declaration)
    assert.deepEqual(observe(), original)
    assert.match(invoke(native, ["-p", "tsconfig.json", "--pretty", "false", "--fix"]), /0 fixes in 0 files/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("annotated generator stages preserve their pre-stage return contract", () => {
  assert.ok(existsSync(native), "build the native compiler first")
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(rule), "update the tooling oracle")
  verify(corpus.input)
  verify({ ...corpus.input, form: "plain", mapped: true, nested: false })
  fc.assert(fc.property(fc.record({
    form: fc.constantFrom("named", "plain", "untraced"),
    nested: fc.boolean(), mapped: fc.boolean(),
    value: fc.integer({ min: -20, max: 20 })
  }), verify), { seed: 100233, numRuns: 32 })
})

