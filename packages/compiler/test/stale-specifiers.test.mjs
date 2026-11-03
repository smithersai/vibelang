import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { migrateStaleSpecifiers } from "../../../.smithers/flows/migrate/lib/stale-specifiers.mjs"

test("stale imports follow every tsconfig matrix cell, native matches and a second run stay unchanged", () => {
  for (const resolution of ["node10", "node16", "nodenext", "bundler"])
    for (const allow of [false, true]) for (const rewrite of [false, true])
      for (const sourceExt of [".vibe", ".vibex"]) {
        const root = mkdtempSync(join(tmpdir(), "vibe-stale-"))
        try {
          const nativeExt = sourceExt === ".vibe" ? ".ts" : ".tsx"
          const options = { moduleResolution: resolution, module: ["node16", "nodenext"].includes(resolution) ? resolution : "esnext",
            allowImportingTsExtensions: allow, rewriteRelativeImportExtensions: rewrite, jsx:"preserve" }
          writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions: options}))
          writeFileSync(join(root, "target" + sourceExt), "export const value = 1")
          writeFileSync(join(root, "native.ts"), "export const value = 2")
          writeFileSync(join(root, "native.vibe"), "export const value = 3")
          const source = "export { value } from './target" + nativeExt + "'\n" +
            "export type T = import('./target" + nativeExt + "').T\n" +
            "export { value as native } from './native.ts'\n" +
            "export const literal = './target" + nativeExt + "'\n// import('./target" + nativeExt + "')\n"
          writeFileSync(join(root, "main.vibe"), source)
          const nextExt = rewrite ? sourceExt : sourceExt === ".vibex" ? ".jsx" : ".js"
          const expected = source.replaceAll("from './target" + nativeExt, "from './target" + nextExt).replace("import('./target" + nativeExt + "').T", "import('./target" + nextExt + "').T")
          assert.equal(migrateStaleSpecifiers(ts, root, ["main.vibe"]).length, 2)
          assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), expected)
          assert.deepEqual(migrateStaleSpecifiers(ts, root, ["main.vibe"]), [])
        } finally { rmSync(root, {recursive:true, force:true}) }
      }
})

test("extended configs, type-only projects and foreign importers share the repair", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-stale-"))
  try {
    writeFileSync(join(root, "base.json"), JSON.stringify({compilerOptions:{moduleResolution:"bundler",module:"esnext",noEmit:true,allowImportingTsExtensions:true}}))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({extends:"./base.json"}))
    writeFileSync(join(root, "target.vibe"), "export const value = 1")
    const files = ["main.ts", "other.vibe", "script.mjs"]
    for (const file of files) writeFileSync(join(root, file), "export { value } from './target.ts'\n")
    assert.equal(migrateStaleSpecifiers(ts, root, files).length, 3)
    for (const file of files) assert.match(readFileSync(join(root, file), "utf8"), /target\.vibe/)
    assert.deepEqual(migrateStaleSpecifiers(ts, root, files), [])
  } finally { rmSync(root,{recursive:true,force:true}) }
})

test("the batch migrate codemod uses NodeNext runtime names unless source rewriting is enabled", async () => {
  const { pathAliases, rewriteImports } = await import("../../../.smithers/flows/migrate/lib/codemod.mjs")
  for (const rewrite of [false,true]) {
    const root = mkdtempSync(join(tmpdir(), "vibe-stale-"))
    try {
      writeFileSync(join(root,"tsconfig.json"), JSON.stringify({compilerOptions:{module:"nodenext",moduleResolution:"nodenext",rewriteRelativeImportExtensions:rewrite}}))
      writeFileSync(join(root,"main.vibe"), "export { value } from './target.ts'\n")
      writeFileSync(join(root,"target.vibe"), "export const value = 1")
      rewriteImports(root, ["main.vibe","target.vibe"], ["target.vibe"], pathAliases(ts, root))
      assert.equal(readFileSync(join(root,"main.vibe"),"utf8"), "export { value } from './target" + (rewrite ? ".vibe" : ".js") + "'\n")
    } finally { rmSync(root,{recursive:true,force:true}) }
  }
})

test("moduleSuffixes repairs the resolved migrated sibling while native suffix matches keep their identity", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-stale-suffix-"))
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions:{
      module:"nodenext", moduleResolution:"nodenext", moduleSuffixes:[".native",""], rewriteRelativeImportExtensions:true
    }}))
    writeFileSync(join(root, "target.native.vibe"), "export const value = 1")
    writeFileSync(join(root, "main.vibe"), "export { value } from './target.ts'\n")
    assert.equal(migrateStaleSpecifiers(ts, root, ["main.vibe"]).length, 1)
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), "export { value } from './target.vibe'\n")
    assert.deepEqual(migrateStaleSpecifiers(ts, root, ["main.vibe"]), [])
    writeFileSync(join(root, "target.ts"), "export const value = 2")
    writeFileSync(join(root, "main.vibe"), "export { value } from './target.ts'\n")
    assert.deepEqual(migrateStaleSpecifiers(ts, root, ["main.vibe"]), [])
  } finally { rmSync(root,{recursive:true,force:true}) }
})

test("emitted JavaScript and declarations do not mask a migrated source during repair", () => {
  for (const artifact of [".d.ts", ".js"]) {
    const root = mkdtempSync(join(tmpdir(), "vibe-stale-artifact-"))
    try {
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({compilerOptions:{
        module:"nodenext",moduleResolution:"nodenext",rewriteRelativeImportExtensions:true
      }}))
      writeFileSync(join(root, "target.vibe"), "export const value = 1")
      writeFileSync(join(root, "target"+artifact), artifact === ".js" ? "export const value = 2" : "export declare const value: number")
      writeFileSync(join(root, "main.vibe"), "export { value } from './target.ts'\n")
      assert.equal(migrateStaleSpecifiers(ts,root,["main.vibe"]).length,1)
      assert.equal(readFileSync(join(root,"main.vibe"),"utf8"),"export { value } from './target.vibe'\n")
    } finally {rmSync(root,{recursive:true,force:true})}
  }
})

test("rootDirs and paired sidecar suffixes retain the source selected by resolution", () => {
  for (const suffixes of [["",".d.vibe"],[".d.vibe",""],[".d.vibe"]]) {
    const root=mkdtempSync(join(tmpdir(),"vibe-stale-paired-"))
    try {
      writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"nodenext",moduleResolution:"nodenext",moduleSuffixes:suffixes,rewriteRelativeImportExtensions:true}}))
      writeFileSync(join(root,"target.vibe"),"export const value = 1")
      writeFileSync(join(root,"target.d.vibe.ts"),"export declare const value: number")
      writeFileSync(join(root,"main.vibe"),"export { value } from './target.ts'\n")
      assert.equal(migrateStaleSpecifiers(ts,root,["main.vibe"]).length,suffixes[0]===""?1:0)
    } finally {rmSync(root,{recursive:true,force:true})}
  }
})

test("rootDirs repairs the migrated source from an alternate project root", () => {
  const root=mkdtempSync(join(tmpdir(),"vibe-stale-rootdirs-"))
  try {
    mkdirSync(join(root,"src"));mkdirSync(join(root,"generated"))
    writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:{module:"nodenext",moduleResolution:"nodenext",rootDirs:["src","generated"],rewriteRelativeImportExtensions:true}}))
    writeFileSync(join(root,"generated/target.vibe"),"export const value = 1")
    writeFileSync(join(root,"src/main.vibe"),"export { value } from './target.ts'\n")
    assert.equal(migrateStaleSpecifiers(ts,root,["src/main.vibe"]).length,1)
    assert.equal(readFileSync(join(root,"src/main.vibe"),"utf8"),"export { value } from './target.vibe'\n")
  } finally {rmSync(root,{recursive:true,force:true})}
})
