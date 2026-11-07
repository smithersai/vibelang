import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-project-type-directive-origin.json", import.meta.url), "utf8"))
const put = (file, text) => { mkdirSync(dirname(file), {recursive:true}); writeFileSync(file, text) }

test("project type directive origin quotes the declaration identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

function witness({ depth = 0, changed = false, missing = false, written = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "project-type-origin-"))
  const projectContexts = [], entries = [], bases = []
  try {
    for (const side of ["before", "after"]) {
      const outer = join(root, side), project = join(outer, "package", "nested/".repeat(depth)), external = join(outer, "external/helper.ts")
      const snapshot = join(outer, "snapshot"), entry = join(snapshot, "index.d.ts"), savedExternal = join(snapshot, "external/helper.ts"), stockEntry = join(project, "index.d.ts")
      const importPath = "../".repeat(depth + 1) + "external/helper.js"
      put(stockEntry, corpus.entry.replace("../../external/helper.js", importPath))
      put(entry, corpus.entry.replace("../../external/helper.js", "./external/helper.js"))
      put(external, (written ? '/// <reference types="source-only" />\n' : "") +
        (changed && side === "after" ? 'export const value = "changed";\n' : corpus.helper))
      put(savedExternal, readFileSync(external, "utf8"))
      put(join(snapshot,"package.json"), '{"type":"module","types":"./index.d.ts"}')
      put(join(project, "package.json"), '{"type":"module","types":"./index.d.ts"}')
      if (!missing) {
        put(join(project, "node_modules/desktop-types/package.json"), '{"name":"desktop-types","version":"1.0.0","types":"index.d.ts"}')
        put(join(project, "node_modules/desktop-types/index.d.ts"), corpus.ambient)
      }
      if (written) for (const directory of [join(outer,"external"),join(snapshot,"external")]) put(join(directory, "node_modules/@types/source-only/index.d.ts"), "declare namespace SourceOnly { type Value = true }\n")
      const compilerOptions = { strict:true, skipLibCheck:true, module:ts.ModuleKind.ESNext,
        moduleResolution:ts.ModuleResolutionKind.Bundler, target:ts.ScriptTarget.ESNext, lib:["lib.es5.d.ts"], types:["desktop-types"],
        configFilePath:join(project,"tsconfig.json"), noEmit:true }
      put(compilerOptions.configFilePath, JSON.stringify({ compilerOptions: {types:["desktop-types"]}, files:["index.d.ts"] }))
      const stock = ts.createProgram([stockEntry], compilerOptions)
      const errors = ts.getPreEmitDiagnostics(stock).map(d => d.code)
      assert.deepEqual(errors, missing ? [2688, 2503] : [], "stock TypeScript project environment")
      const { configFilePath, ...recordedOptions } = compilerOptions
      projectContexts.push({directory:project,compilerOptions:recordedOptions,files:[entry,savedExternal]})
      entries.push({".":entry}); bases.push(snapshot)
    }
    const result = compareApiIdentity(ts, ...bases, {
      beforeEntrypoints:entries[0], afterEntrypoints:entries[1], projectContexts, moduleRoots:[],
      compilerOptions:{lib:["lib.es5.d.ts"]}
    })
    assert.equal(result.comparisonComplete, !missing, JSON.stringify(result))
    assert.equal(result.identical, !missing && !changed, JSON.stringify(result))
    if (changed) assert.ok(result.typeDifferences.length, JSON.stringify(result))
    if (missing) assert.ok(result.environmentDiagnostics.some(d => /TS2688/.test(d.diagnostic)), JSON.stringify(result))
    return result
  } finally { rmSync(root,{recursive:true,force:true}) }
}

test("t3code external helpers resolve project type packages at the project root", () => witness())
test("changed external exports remain API differences with project ambient types", () => witness({changed:true}))
test("a missing project type package still makes comparison unavailable", () => witness({missing:true}))
test("written type references retain the source file's resolution origin", () => witness({written:true}))
test("property: external-source depth preserves ambient availability and real differences", () => {
  fc.assert(fc.property(fc.integer({min:0,max:3}), fc.boolean(), (depth,changed) => { witness({depth,changed}) }),
    {seed:26884402,numRuns:20})
})
