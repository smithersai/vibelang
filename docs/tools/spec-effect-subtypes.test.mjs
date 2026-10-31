import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { block, chapter, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("Effect subtype examples remain structural in execution and thrown contracts", () => {
  for (const source of [running(), failures()]) {
    assert.match(source, /not (?:an )?exhaustive list|list is not exhaustive/)
    assert.match(source, /Exit/)
    assert.match(source, /Config/)
  }
  assert.match(failures(), /Exit.Exit<number>.*EK0401/)
  const dir = mkdtempSync(join(tools, ".spec-effect-subtypes-"))
  try {
    const file = join(dir, "example.mts")
    writeFileSync(file, block(running(), "function operands()") + `
import type { Fiber, Layer, Stream } from "effect"
type Admitted<T> = [T] extends [Effect.Effect<any, any, any>] ? true : false
type Assert<T extends true> = T
type YesExit = Assert<Admitted<Exit.Exit<number>>>
type YesConfig = Assert<Admitted<Config.Config<number>>>
type YesUnion = Assert<Admitted<Exit.Exit<number> | Config.Config<number>>>
type YesAny = Assert<Admitted<any>>
type YesNever = Assert<Admitted<never>>
type NoUnknown = Assert<Admitted<unknown> extends false ? true : false>
type NoMixed = Assert<Admitted<Exit.Exit<number> | undefined> extends false ? true : false>
type NoStream = Assert<Admitted<Stream.Stream<number>> extends false ? true : false>
type NoLayer = Assert<Admitted<Layer.Layer<never>> extends false ? true : false>
type NoFiber = Assert<Admitted<Fiber.Fiber<number>> extends false ? true : false>
`)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the exact Exit and Config counterpart succeeds with 15", () => {
  const result = run(block(running(), "function operands()") + `
import assert from "node:assert/strict"
const exit = await Effect.runPromiseExit(operands())
assert.equal(Exit.isSuccess(exit), true)
if (Exit.isSuccess(exit)) assert.equal(exit.value, 15)
`)
  assert.equal(result.status, 0, result.stderr)
})
