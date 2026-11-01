import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import ts from "typescript"
import { chapter, read, tools } from "./spec-witness.mjs"

test("cyclic declaration serialization has a narrow public exception", () => {
  for (const text of [chapter("001-functions"), read("docs/design/vips/0027-declaration-output.md")]) {
    assert.ok(text.includes("/*elided*/ any"), "publish the cyclic declaration output")
    assert.ok(text.includes("TS5088"), "identify the overridden serialization diagnostic")
    for (const code of ["TS7022", "TS7023", "TS7024"]) assert.ok(text.includes(code))
  }
  assert.match(chapter("000-intro"), /cyclic inferred types/)
})

test("the printed recursive builder emits the TypeScript 5.9 elision without masking inference errors", () => {
  const source = chapter("001-functions")
  const witness = [...source.matchAll(/```ts effect\n([\s\S]*?)```/g)]
    .find(m => m[1].includes("const makeBuilder"))?.[1]
  assert.ok(witness, "the chapter includes the complete ordinary TypeScript counterpart")
  const dir = mkdtempSync(join(tools, ".spec-cyclic-"))
  try {
    const file = join(dir, "builder.ts")
    writeFileSync(file, witness)
    const options = { strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true,
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
    const program = ts.createProgram([file], options)
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
    program.emit()
    const output = readFileSync(join(dir, "builder.d.ts"), "utf8")
    assert.match(output, /named: \(value: string\) => \/\*elided\*\/ any/)
    writeFileSync(file, "export function bad(n: number) { return n ? bad(n - 1) : 0 }\n")
    const bad = ts.createProgram([file], options)
    assert.ok(ts.getPreEmitDiagnostics(bad).some(d => d.code === 7023), "ordinary recursive inference still fails")
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
