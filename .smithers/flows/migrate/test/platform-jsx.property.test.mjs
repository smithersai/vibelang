import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule, platformPath } from "../lib/platform.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-jsx-callback.json", import.meta.url)))

function check({ extension, value, inline }) {
  const file = "src/view." + extension
  const text = corpus.source.replaceAll("VALUE", String(value))
  const writes = new Map()
  const result = splitBatchPlatform(".", [file], ts, {
    read: () => text, exists: () => false, write: (path, text) => writes.set(path, text),
    moduleBodies: inline
  })
  assert.equal(result.refused.length, 0, result.refused.join("\n"))
  assert.equal(result.splits.length, 1, JSON.stringify({ extension, inline, result }))
  const output = writes.get(file)
  assert.match(output, /export const kept = /)
  const signature = ts.transpileDeclaration(text, { compilerOptions: { isolatedDeclarations: true }, fileName: "view.tsx" }).outputText
  const projected = ts.transpileDeclaration(output, { compilerOptions: { isolatedDeclarations: true }, fileName: "view.tsx" }).outputText
  assert.equal(projected, signature, "the native sibling keeps the public declaration")
  const twin = ts.createSourceFile("view.tsx", output.replace(/module platform \{[\s\S]*?\n\}/, "").replace(/from platform/g, 'from "./platform"'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(twin.parseDiagnostics.length, 0)
  if (result.splits[0].platform) {
    assert.equal(result.splits[0].platform, platformPath(file))
    const native = writes.get(result.splits[0].platform)
    assert.match(native, /<span>\{sep\}<\/span>/)
    assert.equal(ts.createSourceFile("native.tsx", native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  }
}

test("platform extraction visits TSX and Vibex callbacks", () => {
  for (const extension of ["tsx", "vibex"]) check({ extension, value: 7, inline: false })
})

test("platform JSX extraction varies native callbacks and module-body fallback", () => {
  fc.assert(fc.property(fc.record({ extension: fc.constantFrom("tsx", "vibex"),
    value: fc.integer(), inline: fc.boolean() }), check), { numRuns: 50 })
})

test("JSX module-body fallback keeps the source JSX parse kind", () => {
  for (const extension of ["tsx", "vibex"]) {
    const text = 'import { sep } from "node:path"\nexport const view = () => <span>{sep}</span>\nexport const kept = 1\n'
    const result = splitPlatformToModule(text, "src/view." + extension, ts)
    assert.ok(result && !result.refused, JSON.stringify(result))
    assert.match(result.module, /<span>\{sep\}<\/span>/)
    const body = result.module.slice(result.module.indexOf("{") + 1, result.module.indexOf("\n}"))
    assert.equal(ts.createSourceFile("body.tsx", body, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
  }
})

test("JSX import.meta callbacks keep their native parser and companion kind", () => {
  for (const extension of ["tsx", "vibex"]) {
    const result = splitPlatform('export const view = <span>{() => import.meta.resolve("./x")}</span>\n', "src/view." + extension, ts)
    assert.ok(result && !result.refused, JSON.stringify(result))
    assert.match(result.module, /<span>/)
    assert.match(result.module, /view.platform.tsx/)
  }
})
