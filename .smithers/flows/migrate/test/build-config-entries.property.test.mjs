import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { ownedToolConfigs } from "../lib/tool-config-references.mjs"
import { rewriteSourceLiterals } from "../lib/source-paths.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-build-config-entries.json", import.meta.url)))
const keys = corpus.variants
test("property: owned build entries follow the same source; protected and foreign configs retain bytes", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"),"utf8").includes(corpus.quote))
  fc.assert(fc.property(
    fc.constantFrom(...keys), fc.constantFrom("ts","mts","cts","js","mjs","cjs"),
    fc.constantFrom('"',"'",String.fromCharCode(96)),
    fc.constantFrom("entry","deep/worker","worker space","facade.alt","café"),
    (key, ext, quote, name) => {
      const root = mkdtempSync(join(tmpdir(),"alchemy-entry-property-"))
      const put = (file,text) => {mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
      try {
        put("package.json",JSON.stringify({private:true,type:"module",workspaces:["packages/*"]}))
        put("packages/a/package.json",'{"name":"a"}')
        put("packages/b/package.json",'{"name":"b"}')
        put("vendor/dep/package.json",'{"name":"external"}')
        put(".gitmodules",'[submodule "external"]\n path = submodules/external\n url = example.invalid\n')
        const tool=key.split("-")[0], cfg="packages/a/"+tool+".config."+ext
        const value="src/"+name+".ts", source="packages/a/"+value, target=source.replace(/\.ts$/,".vibe")
        put(source,"export const value = 42\n")
        put("packages/b/"+value,"export const value = 99\n")
        const literal=quote+value+quote
        const config="// "+value+"\n"+(ext==="cjs" ? "module.exports = " : "export default ")+(
          key==="tsdown-array" ? "{entry:["+literal+"]}" :
          key==="tsup-map" ? "{entry:{publicName:"+literal+"}}" :
          key==="rolldown-input" ? "{input:"+literal+"}" : "{build:{lib:{entry:"+literal+"}}}"
        )+(/ts$/.test(ext) ? "\ntype AuthoredName = "+literal+"\n" : "\n")
        const protectedFiles=[
          "packages/a/test/"+tool+".config."+ext,"packages/a/fixtures/"+tool+".config."+ext,
          "packages/a/e2e/"+tool+".config."+ext,"packages/a/testdata/"+tool+".config."+ext,
          "packages/a/dist/"+tool+".config."+ext,"packages/a/node_modules/"+tool+".config."+ext,
          "vendor/dep/"+tool+".config."+ext,"submodules/external/"+tool+".config."+ext,
          "packages/a/vitest.config."+ext,"packages/a/playwright.config."+ext,
          "packages/a/jest.unit.config."+ext
        ]
        const foreign="packages/b/"+tool+".config."+ext
        for (const file of [cfg,foreign,...protectedFiles]) put(file,config)
        const inventory=[source,"packages/b/"+value,cfg,foreign,...protectedFiles]
        const selected=ownedToolConfigs(root,inventory)
        assert.deepEqual(selected,[cfg,foreign],key)
        const renamed=[{from:source,to:target}]
        for (const file of selected) {
          const result=rewriteSourceLiterals(ts,config,file,renamed,{inventory})
          if (file===cfg) {
            assert.equal(result.edits.length,1,key)
            assert.equal(result.edits[0].module,target)
            assert.equal(result.text,config.replace(literal,literal.replace(/\.ts(?=.)/,".vibe")),key)
            assert.deepEqual(rewriteSourceLiterals(ts,result.text,file,renamed,{inventory}).edits,[],key)
          } else assert.equal(result.text,config,key)
        }
        for (const file of protectedFiles) assert.equal(readFileSync(join(root,file),"utf8"),config,file)
      } finally {rmSync(root,{recursive:true,force:true})}
    }),{seed:560056,numRuns:240})
})
