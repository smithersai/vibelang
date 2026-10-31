import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { block, chapter, read, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")
const vip5 = () => process.env.SPEC_VIP5 ? readFileSync(process.env.SPEC_VIP5, "utf8") : read("docs/design/vips/0005-try-runs-effects.md")

test("the catch head rule covers every erased wrapper and preserves source parentheses", () => {
  for (const text of [running(), vip5()]) {
    assert.match(text, /angle-bracket assertions/)
    assert.match(text, /type-only instantiation expressions/)
    assert.match(text, /non-null/)
    assert.match(text, /source parentheses/)
    assert.match(text, /(?:emitter-added|added by emission)/)
  }
  const source = block(running(), "function rejectedCatchHeads(", "vibe es")
  assert.equal([...source.matchAll(/\/\/ EK0505/g)].length, 5)
  assert.match(source, /return \(try nested\) as/)
})

const wrappers = `
import assert from "node:assert/strict"
const receiver = { n: 7, method<T>(x: T) { return [this.n, x] as const } }
const results = [
  (receiver.method as typeof receiver.method)(1),
  (<typeof receiver.method>receiver.method)(1),
  (receiver.method satisfies typeof receiver.method)(1),
  receiver.method!(1),
  receiver.method<number>(1)
]
assert.deepEqual(results, Array.from({ length: 5 }, () => [7, 1]))
`

test("native wrappers erase without changing a method receiver and the exact counterpart type-checks", () => {
  const dir = mkdtempSync(join(tools, ".spec-catch-wrappers-"))
  try {
    const file = join(dir, "example.ts")
    writeFileSync(file, block(running(), "function groupedHead(") + wrappers)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      types: ["node"], typeRoots: [join(tools, "node_modules/@types")],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\n"
    }))
    const emitted = ts.transpileModule(wrappers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    const result = spawnSync("node", ["--input-type=module", "--eval", emitted], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("the parenthesized witness catches the inner failure while the outer failure propagates", () => {
  const result = run(block(running(), "function groupedHead(") + `
import assert from "node:assert/strict"
assert.equal(await Effect.runPromise(groupedHead(Effect.succeed(Effect.fail("inner")))), 7)
assert.equal(await Effect.runPromise(groupedHead(Effect.succeed(Effect.succeed(8)))), 8)
assert.equal(await Effect.runPromise(Effect.flip(groupedHead(Effect.fail("outer")))), "outer")
`)
  assert.equal(result.status, 0, result.stderr)
})
