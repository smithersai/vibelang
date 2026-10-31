import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { chapter, repo, run, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the await comparison includes the documented operand and syntax differences", () => {
  const text = running()
  assert.ok(text.includes("is `await e.catch(h)`"))
  const section = text.slice(text.indexOf("| Promise | Effect | Why |"))
  for (const [needle, code] of [["statically non-Effect", "EK0502"], ["try e catch h", "EK0505"], ["statement-start", "EK0503"], ["for try (x of stream)", "EK2005"]]) {
    const row = section.split("\n").find(line => line.startsWith("|") && line.includes(needle))
    assert.ok(row, needle)
    assert.ok(row.includes(code), row)
  }
  assert.match(section, /ForDeclaration/)
  assert.match(section, /optional-call syntax/)
})

test("native await accepts the contrasting operands, statement and assignment head", () => {
  const source = `
import assert from "node:assert/strict"
import { Effect } from "effect"
function operandTypes(scalar: number, optional: Effect.Effect<number> | undefined) {
  // @ts-expect-error a typed scalar is not an Effect
  const scalarEffect: Effect.Effect<any, any, any> = scalar
  // @ts-expect-error the possibly undefined member fails Effect assignability
  const optionalEffect: Effect.Effect<any, any, any> = optional
  return [scalarEffect, optionalEffect]
}
void operandTypes
async function native() {
  const scalar = await 1
  const receiver: { value?: () => Promise<number> } = {}
  const optional = await receiver.value?.()
  await { value: 1 }
  let x = 0
  for await (x of [Promise.resolve(1), 2]) {}
  const caught = await Promise.reject("bad").catch(() => 7)
  return [scalar, optional, x, caught]
}
assert.deepEqual(await native(), [1, undefined, 2, 7])
assert.equal(Effect.runSync(Effect.catch(Effect.fail("bad"), () => Effect.succeed(7))), 7)
console.log("native operands, statement, assignment head and handled result pass")
`
  const dir = mkdtempSync(join(tools, ".spec-await-differences-"))
  try {
    const file = join(dir, "native.mts")
    writeFileSync(file, source)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ["node"], typeRoots: [join(tools, "node_modules/@types")] })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [], ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: x => x, getCurrentDirectory: () => repo, getNewLine: () => "\\n"
    }))
  } finally { rmSync(dir, { recursive: true, force: true }) }
  const result = run(source)
  assert.equal(result.status, 0, result.stderr)
})

test("the for try head row names every head for await accepts and for try rejects", () => {
  const row = running().split("\n").find(line => line.startsWith("| `for await (x of values)`"))
  assert.ok(row, "the for try head row")
  assert.match(row, /`for await` accepts `var`, `using` and `await using` heads/)
  assert.match(row, /`for try` with any head other than a `const` or `let` declaration is `EK2005`/)
  for (const head of ["var x", "using x", "await using x"]) {
    assert.doesNotThrow(() => new Function(`return async function f(y) { for await (${head} of y) {} }`), head)
  }
})
