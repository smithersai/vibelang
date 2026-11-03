import test from "node:test"
import assert from "node:assert/strict"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { migrateStaleSpecifiers } from "../../../.smithers/flows/migrate/lib/stale-specifiers.mjs"

test("detail 296: option and specifier mutations preserve native identity and remove stale names", () => {
  fc.assert(fc.property(
    fc.constantFrom("node10","node16","nodenext","bundler"),
    fc.boolean(), fc.boolean(), fc.boolean(), fc.constantFrom("none",".ts",".tsx",".d.ts",".js"), fc.boolean(),
    fc.boolean(), fc.boolean(), fc.constantFrom(".vibe",".vibex"), fc.constantFrom("'",'"'),
    (resolution,allow,rewrite,noEmit,nativeKind,suffix,rootDirs,nativeAlternate,ext,quote) => {
      const root = mkdtempSync(join(tmpdir(),"stale-property-"))
      try {
        const sourceExt = ext === ".vibe" ? ".ts" : ".tsx"
        const mainFile = rootDirs ? "src/main.vibe" : "main.vibe"
        const targetDir = rootDirs ? "generated" : "."
        const nativeDir = rootDirs ? nativeAlternate ? "generated" : "src" : "."
        if(rootDirs) { mkdirSync(join(root,"src")); mkdirSync(join(root,"generated")) }
        const options = {module: ["node16","nodenext"].includes(resolution)?resolution:"esnext",
          moduleResolution:resolution,allowImportingTsExtensions:allow,rewriteRelativeImportExtensions:rewrite,noEmit,jsx:"preserve",moduleSuffixes:suffix?[".native",""]:[""],rootDirs:rootDirs?["src","generated"]:undefined}
        writeFileSync(join(root,"tsconfig.json"),JSON.stringify({compilerOptions:options}))
        writeFileSync(join(root,targetDir,"target"+(suffix?".native":"")+ext),"export const value = 1")
        const implementation = nativeKind === ".ts" || nativeKind === ".tsx"
        if(nativeKind !== "none") writeFileSync(join(root,nativeDir,"target"+nativeKind),nativeKind === ".d.ts" ? "export declare const value: number" : "export const value = 2")
        const twin = join(root,targetDir,"target"+(suffix?".native":"")+sourceExt)
        const parsed = ts.convertCompilerOptionsFromJson(options,root).options
        const resolved = ts.resolveModuleName("./target"+sourceExt,join(root,mainFile),parsed,{
          ...ts.sys,fileExists:path=>path===twin||ts.sys.fileExists(path)
        }).resolvedModule
        const native = implementation || resolved?.resolvedFileName !== twin
        const text = "export { value } from "+quote+"./target"+sourceExt+quote+"\n"
        writeFileSync(join(root,mainFile),text)
        const chosen = rewrite || allow && noEmit ? ext : ext === ".vibex" ? ".jsx" : ".js"
        const edits=migrateStaleSpecifiers(ts,root,[mainFile])
        assert.equal(edits.length,native?0:1)
        assert.equal(readFileSync(join(root,mainFile),"utf8"),native?text:text.replace(sourceExt,chosen))
        assert.deepEqual(migrateStaleSpecifiers(ts,root,[mainFile]),[])
      } finally {rmSync(root,{recursive:true,force:true})}
    }),{numRuns:160,seed:296})
})
