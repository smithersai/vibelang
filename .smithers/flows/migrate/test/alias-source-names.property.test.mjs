import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { addCompilerOptions, aliasSourceNameOptions } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-app-alias-source-names.json", import.meta.url), "utf8"))
const wired = text => addCompilerOptions(text, { allowArbitraryExtensions: true, ...aliasSourceNameOptions(text, ts) })

function diagnostics(text) {
  const root = mkdtempSync(join(tmpdir(), "alias-source-names-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "tsconfig.json"), text)
    writeFileSync(join(root, "src/index.ts"), corpus.importer)
    writeFileSync(join(root, "src/leaf.ts"), corpus.leaf)
    const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, types: [], noEmit: true, emitDeclarationOnly: false, declaration: false })
    return ts.getPreEmitDiagnostics(program).map(d => d.code)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a declaration-only project with aliases accepts a migrated module's source name", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  const project = JSON.stringify(corpus.project, null, 2)
  assert.ok(diagnostics(project).includes(5097))
  assert.deepEqual(diagnostics(wired(project)), [])
})

test("property: only a project with aliases and no JavaScript output gains the option, and an explicit value stays", () => {
  fc.assert(fc.property(fc.boolean(), fc.constantFrom("noEmit", "emitDeclarationOnly", "none"), fc.boolean(), fc.constantFrom(undefined, true, false), (paths, output, rewrite, explicit) => {
    const compilerOptions = { ...(paths ? { paths: { "@/*": ["./src/*"] } } : {}), ...(output === "none" ? {} : { [output]: true }),
      ...(rewrite ? { rewriteRelativeImportExtensions: true } : {}), ...(explicit === undefined ? {} : { allowImportingTsExtensions: explicit }) }
    const after = ts.parseConfigFileTextToJson("tsconfig.json", wired(JSON.stringify({ compilerOptions }, null, 2))).config.compilerOptions
    const expected = explicit ?? (paths && output !== "none" && !rewrite ? true : undefined)
    assert.equal(after.allowImportingTsExtensions, expected)
  }), { numRuns: 60, seed: 272729 })
})
