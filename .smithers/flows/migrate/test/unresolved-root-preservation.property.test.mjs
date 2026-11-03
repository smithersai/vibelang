// Chapter 1: Declarations are exactly what idiomatic Effect TypeScript would declare.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-handwritten-root-shadow.json", import.meta.url), "utf8"))

// VIP-27 and Chapter 7's safe-fix contract preserve the actual public surface.
// Equality of unresolved-root lists proves no such preservation. The native
// TypeScript oracle below resolves a shipped handwritten root: adding a file
// beside an existing directory changes export-star resolution without changing
// one old declaration byte (decide-live's foldkit-80 counterexample, 04:09Z).
function exportsOf(root, file) {
  const program = ts.createProgram([join(root, file)], {
    module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true, skipLibCheck: true, types: [], noEmit: true
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => d.code), [])
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(join(root, file))
  const symbol = checker.getSymbolAtLocation(source)
  return checker.getExportsOfModule(symbol).flatMap((entry) => {
    if (entry.flags & ts.SymbolFlags.Alias) {
      const resolved = checker.getAliasedSymbol(entry)
      if (resolved.flags & ts.SymbolFlags.Module) {
        return checker.getExportsOfModule(resolved).map((member) => entry.name + "." + member.name)
      }
    }
    return [entry.name]
  }).sort()
}

function check(input) {
  const root = mkdtempSync(join(tmpdir(), "migrate-root-shadow-"))
  try {
    const before = join(root, "before")
    const after = join(root, "after")
    const wrapper = input.namespace ? 'export * as Feature from "./dist/' + input.stem + '"\n' : 'export * from "./dist/' + input.stem + '"\n'
    const declarations = 'export declare const original: "original";\n'
    for (const dir of [before, after]) {
      mkdirSync(join(dir, "dist", input.stem), { recursive: true })
      writeFileSync(join(dir, "ambient.d.ts"), wrapper)
      writeFileSync(join(dir, "dist", input.stem, "index.d.ts"), declarations)
      const surface = { roots: ["../ambient.d.ts"], reachable: [input.stem + "/index.d.ts"], unresolved: ["../ambient.d.ts"] }
      writeFileSync(join(dir, "dist", "public-surface.json"), JSON.stringify(surface))
    }
    const prefix = input.namespace ? "Feature." : ""
    assert.deepEqual(exportsOf(before, "ambient.d.ts"), [prefix + "original"])
    writeFileSync(join(after, "dist", input.stem + ".d.ts"), 'export declare const introduced: "introduced";\n')
    assert.deepEqual(exportsOf(after, "ambient.d.ts"), [prefix + "introduced"])
    const changed = compareDeclarations(ts, join(before, "dist"), join(after, "dist"))
    assert.equal(changed.identical, false, "matching unresolved roots must not hide a changed native export")
    assert.deepEqual(changed.added, [input.stem + ".d.ts"])
    assert.deepEqual(changed.addedPrivate, [])
    assert.equal(changed.comparisonComplete,false)
    assert.deepEqual(changed.changed,[])
    // Restore actual publication evidence, then prove the resolver-selected
    // shadow changes the API without changing the old declaration text.
    for(const dir of [before,after]){
      writeFileSync(join(dir,"package.json"),JSON.stringify({types:"./ambient.d.ts"}))
      writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{rootDir:"src",outDir:"dist",declaration:true},include:["src/**/*"]}))
      mkdirSync(join(dir,"src",input.stem),{recursive:true})
      writeFileSync(join(dir,"src",input.stem,"index.ts"),"export {};")
      recordDeclarationSurface(ts,join(dir,"dist"),dir,[{tsconfig:"tsconfig.json",prefix:"."}])
    }
    const proven=compareDeclarations(ts,join(before,"dist"),join(after,"dist"))
    assert.equal(proven.comparisonComplete,true,JSON.stringify(proven))
    assert.equal(proven.identical,false,JSON.stringify(proven))
    assert.ok(proven.nameDifferences.length,JSON.stringify(proven))

    // A genuinely private addition is admitted after complete root resolution,
    // never merely because both runs failed to resolve the same root.
    rmSync(join(after, "dist", input.stem + ".d.ts"))
    writeFileSync(join(after, "dist", "private.d.ts"), "export declare const privateValue: string;\n")
    assert.deepEqual(exportsOf(after, "ambient.d.ts"), [prefix + "original"])
    for (const dir of [before,after]) recordDeclarationSurface(ts,join(dir,"dist"),dir,[{tsconfig:"tsconfig.json",prefix:"."}])
    const same = compareDeclarations(ts, join(before, "dist"), join(after, "dist"))
    assert.equal(same.identical, true)
    assert.deepEqual(same.addedPrivate, ["private.d.ts"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("foldkit: handwritten export-star and namespace roots keep native resolution priority", () => {
  for (const input of corpus.inputs) check(input)
  fc.assert(fc.property(fc.record({
    stem: fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/).filter((s) => s !== "private"),
    namespace: fc.boolean()
  }), check), { seed: 80008000, numRuns: 40 })
})
