import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { emitErrorsIn as compareEmits, loadTypeScript } from "../lib/declarations.mjs"

import { recordQuotedModuleReferences } from "../lib/quoted-module-emit.mjs"

const runtime = new URL("../../../../packages/runtime/", import.meta.url)
const require = createRequire(new URL("package.json", runtime))
const fc = require("fast-check")
const ts = loadTypeScript([runtime.pathname])
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-mobile-quoted-module-emit.json", import.meta.url)))

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "quoted-module-emit-"))
  const module = join(root, "apps/mobile/node_modules/library/tokenStore")
  mkdirSync(dirname(module), { recursive: true })
  mkdirSync(join(root, "apps/mobile/src"), { recursive: true })
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", strict: true }, files: ["apps/mobile/src/util.ts"] }))
  writeFileSync(join(root, "apps/mobile/src/util.ts"), "export {}\n")
  writeFileSync(module + ".d.ts", "export interface Token { readonly id: string }\n")
  const diagnostic = suffix => ({ ...corpus, notes: [], message: corpus.message.replace("$MODULE", "../node_modules/library/tokenStore" + suffix) })
  const options = { code: 1, baseline: { code: 1, diagnostics: [diagnostic("")] }, cwd: join(root, "apps/mobile"), root, typescript: ts }
  options.baseline.moduleReferences = recordQuotedModuleReferences(options.baseline.diagnostics, options)
  try { return body({ root, module, diagnostic, options }) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

function emitErrorsIn(diagnostics, files, options) {
  return compareEmits(diagnostics, files, { ...options, moduleReferences: recordQuotedModuleReferences(diagnostics, options) })
}

test("t3code mobile: suffix changes require the same resolved declaration", () => fixture(({ diagnostic, options }) => {
  for (const suffix of [".js", ".ts"]) {
    const modulePathSubstitutions = []
    const current = diagnostic(suffix)
    assert.deepEqual(emitErrorsIn([current], [], { ...options, modulePathSubstitutions }), [])
    assert.equal(modulePathSubstitutions.length, 1)
    assert.equal(modulePathSubstitutions[0].declaration, "apps/mobile/node_modules/library/tokenStore.d.ts")
    assert.match(modulePathSubstitutions[0].sha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(current, diagnostic(suffix), "raw evidence stays unchanged")
  }
}))

test("suffix spelling cannot waive missing provenance, changed identities or unexplained exits", () => fixture(({ root, module, diagnostic, options }) => {
  const current = diagnostic(".js")
  const reject = (diagnostics, extra = {}) => assert.ok(emitErrorsIn(diagnostics, [], { ...options, ...extra }).length)
  for (const change of [
    d => ({ ...d, file: "apps/mobile/src/other.ts" }),
    d => ({ ...d, code: "TS4023" }),
    d => ({ ...d, message: d.message.replace("AnimatedNode", "OtherSymbol") }),
    d => ({ ...d, message: d.message.replace("flattenStyles", "other") }),
    d => ({ ...d, message: d.message.replace("tokenStore.js", "other.js") }),
    d => ({ ...d, notes: ["new constraint"] }),
    d => ({ ...d, message: d.message + " More information." })
  ]) reject([change(current)])
  reject([], { code: 1 })
  reject([current, current])
  reject([current], { baseline: undefined })
  reject([current], { root: undefined })
  reject([current], { baseline: { code: 1, diagnostics: [diagnostic(""), { ...diagnostic(""), file: "other.ts" }] } })
  reject([current], { baseline: { code: 1, diagnostics: [diagnostic("")] } })
  writeFileSync(module + ".d.ts", "export interface Token { readonly changed: number }\n")
  reject([current], { root })
  rmSync(module + ".d.ts")
  reject([current])
  writeFileSync(module + ".ts", "export const different = 1\n")
  reject([current], { root })
}))

// The migration contract preserves source, code, message, notes and multiplicity.
// Module spelling is equivalent only with a shared physical declaration receipt.
test("generated suffix neighbourhoods preserve the complete diagnostic census", () => fixture(({ diagnostic, options }) => {
  fc.assert(fc.property(fc.constantFrom(".ts", ".js"), fc.integer({ min: 1, max: 7 }), fc.constantFrom("AnimatedNode", "Token", "Value"), (suffix, count, symbol) => {
    const original = Array.from({ length: count }, () => ({ ...diagnostic(""), message: diagnostic("").message.replace("AnimatedNode", symbol) }))
    const current = original.map(d => ({ ...d, message: d.message.replace("tokenStore'", "tokenStore" + suffix + "'") }))
    const baseline = { code: 1, diagnostics: original, moduleReferences: recordQuotedModuleReferences(original, options) }
    assert.deepEqual(emitErrorsIn(current, [], { ...options, baseline }), [])
    assert.ok(emitErrorsIn(current.slice(1), [], { ...options, baseline }).length)
    assert.ok(emitErrorsIn([...current, current[0]], [], { ...options, baseline }).length)
    assert.ok(emitErrorsIn(current.map(d => ({ ...d, notes: ["changed"] })), [], { ...options, baseline }).length)
  }), { seed: 1402883, numRuns: 120 })
}))
