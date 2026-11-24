import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import test from "node:test"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule, platformPath } from "../lib/platform.mjs"
import { materialize } from "./helpers/host-operations-oracle.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-jsx-callback.json", import.meta.url)))

// The corpus module in a private package: with inline (moduleBodies) the
// split prefers a module body, which adds no package entry; without it the
// split writes a native sibling.
function check({ extension, value, inline }) {
  const file = "src/view." + extension
  const text = corpus.source.replaceAll("VALUE", String(value))
  const writes = new Map()
  const result = splitBatchPlatform(".", [file], ts, {
    read: (path) => path === "package.json" ? '{ "private": true }' : text, exists: (path) => path === "package.json",
    write: (path, text) => writes.set(path, text), moduleBodies: inline
  })
  assert.equal(result.refused.length, 0, result.refused.join("\n"))
  assert.equal(result.splits.length, 1, JSON.stringify({ extension, inline, result }))
  const output = writes.get(file)
  assert.match(output, new RegExp(`^export const kept = ${value}$`, "m"))
  if (inline) {
    assert.equal(result.splits[0].module, "platform")
    assert.equal(result.splits[0].platform, null)
    assert.deepEqual([...writes.keys()], [file])
    const { body, module } = materialize(output, "./view.platform")
    assert.match(body, /<span>\{sep\}<\/span>/)
    assert.match(module, /^export \{ view \} from "\.\/view\.platform"$/m)
    for (const part of [body, module]) assert.equal(ts.createSourceFile("part.tsx", part, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0, part)
    return
  }
  assert.equal(result.splits[0].module, undefined)
  assert.equal(result.splits[0].platform, platformPath(file))
  const declaration = (text) => {
    const { outputText, diagnostics } = ts.transpileDeclaration(text, { compilerOptions: { isolatedDeclarations: true }, fileName: "view.tsx" })
    assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")), [], text)
    return outputText
  }
  assert.equal(declaration(output), declaration(text), "the native sibling keeps the public declaration")
  const native = writes.get(result.splits[0].platform)
  assert.match(native, /<span>\{sep\}<\/span>/)
  assert.equal(ts.createSourceFile("native.tsx", native, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0)
}

test("platform extraction visits TSX and Vibex callbacks", () => {
  for (const extension of ["tsx", "vibex"]) for (const inline of [false, true]) check({ extension, value: 7, inline })
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

test("JSX import.meta callbacks stay in the original module", () => {
  // import.meta follows TypeScript, so a callback that only reads metadata has no platform code to move.
  for (const extension of ["tsx", "vibex"]) {
    assert.equal(splitPlatform('export const view = <span>{() => import.meta.resolve("./x")}</span>\n', "src/view." + extension, ts), null)
  }
})
