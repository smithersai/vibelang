import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { chapter, read, repo, tools } from "./spec-witness.mjs"
const ts = createRequire(join(repo, "experiments/package.json"))("typescript")
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")
const vip13 = () => process.env.SPEC_VIP13 ? readFileSync(process.env.SPEC_VIP13, "utf8") : read("docs/design/vips/0013-error-declarations.md")

test("error-field admission follows each actual counterpart instead of a shared key-type rule", () => {
  const text = failures()
  const start = text.indexOf("Field keys")
  const section = text.slice(start, text.indexOf("## ", start + 1))
  assert.match(section, /TypeLiteral/)
  assert.match(section, /object literal/)
  assert.match(section, /TS1170/)
  assert.ok(section.includes('[keys.value]'))
  assert.ok(section.includes('[(keys.value)]'))
  assert.ok(section.includes('[keys["value"]]'))
  assert.match(section, /call returning a literal/)
  assert.match(vip13(), /TypeLiteral/)
})

test("native TypeLiteral and runtime Schema object admission differ by expression shape", () => {
  const dir = mkdtempSync(join(tools, ".spec-key-admission-"))
  try {
    const file = join(dir, "matrix.mts")
    writeFileSync(file, `
import { Data, Schema } from "effect"
let key: number = 42
const keys = { get value(): number { throw new Error("type-only getter must not run") } }
function numberKey(): number { return 42 }
function literalKey(): 42 { return 42 }
type PlainEntity = { readonly [key]: number; readonly [keys.value]: number }
class Plain extends Data.TaggedError("Plain")<PlainEntity> {}
const schema = Schema.Struct({
  [literalKey()]: Schema.Number,
  [numberKey()]: Schema.Number,
  [(keys.value)]: Schema.Number,
  [keys["value"]]: Schema.Number
})
type BadLiteralCall = { [literalKey()]: number }
type BadCall = { [numberKey()]: number }
type BadParentheses = { [(keys.value)]: number }
type BadElement = { [keys["value"]]: number }
`)
    const program = ts.createProgram([file], {
      strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext
    })
    const errors = ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => d.code), [1170, 1170, 1170, 1170],
      ts.formatDiagnosticsWithColorAndContext(errors, {
        getCanonicalFileName: name => name, getCurrentDirectory: () => repo, getNewLine: () => "\n"
      }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
