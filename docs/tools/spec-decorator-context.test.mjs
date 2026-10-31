import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { chapter, repo, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")

test("a decorator expression runs in its enclosing context, as a computed key does", () => {
  const running = chapter("002-running")
  assert.ok(running.includes("| a computed class key, an `extends` clause, a decorator expression such as `@(try d)` | allowed | allowed |"))
  const appendix = chapter("900-appendices")
  assert.ok(appendix.includes("Class heritage, decorator expressions and computed class element names keep their enclosing source context."))
  assert.ok(appendix.includes("A computed class key, a decorator expression and an `extends` clause are effect code when their enclosing context is:"))
})

test("TypeScript 5.9.3 admits await in a decorator exactly where the enclosing function admits it", () => {
  const dir = mkdtempSync(join(tools, ".spec-decorator-context-"))
  try {
    const file = join(dir, "decorators.ts")
    writeFileSync(file, `declare const mark: (value: unknown, context: ClassMethodDecoratorContext) => void
export async function asyncContext() {
  class C { @(await Promise.resolve(mark)) m() { return 1 } }
  return new C().m()
}
export function plainContext() {
  class D { @(await Promise.resolve(mark)) m() { return 1 } }
  return new D().m()
}
`)
    const program = ts.createProgram([file], { strict: true, noEmit: true, skipLibCheck: true, types: [],
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 })
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error)
    const lines = errors.map((d) => [d.code, d.file.getLineAndCharacterOfPosition(d.start).line + 1])
    assert.equal(ts.version.startsWith("5.9."), true, ts.version)
    assert.deepEqual(lines, [[1308, 7]], "only the plain function's decorator rejects await")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
