import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { codemod, makeConfig, paths } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-interrupted-codemod.json", import.meta.url), "utf8"))

async function inspect(input, literal = false) {
  const root = mkdtempSync(join(tmpdir(), "migrate-interrupted-property-"))
  const repo = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(join(repo, "node_modules/.bin"), { recursive: true })
    symlinkSync(join(runtime, "node_modules/typescript"), join(repo, "node_modules/typescript"))
    const directory = "src/" + Array.from({ length: input.depth }, (_, i) => "p"+i+"/").join("")
    const modules = Array.from({ length: input.count }, (_, i) => directory + "m"+i+".ts")
    const files = { "src/old.vibe": corpus.files["src/old.vibe"] }
    for (const [i, name] of modules.entries()) files[name] = "export const value"+i+" = "+i+";\n"
    files["src/consumer.ts"] = modules.map((name, i) => {
      const path = "./"+posix.relative("src", name).replace(/\.ts$/, input.extension)
      return 'import { value'+i+' } from '+JSON.stringify(path)+';\nexport const copy'+i+' = value'+i+';'
    }).join("\n")+"\n"
    files["package.json"] = '{"name":"fixture","type":"commonjs"}\n'
    files["tsconfig.json"] = '{"compilerOptions":{"strict":true,"noEmit":true},"include":["src"]}\n'
    files[".gitignore"] = "node_modules/\n"
    if (literal) Object.assign(files, corpus.files)
    for (const [name,text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo,name)),{recursive:true})
      writeFileSync(join(repo,name),text)
    }
    const marker=join(root,"killed")
    writeFileSync(join(repo,"node_modules/.bin/vibelang"), [
      "#!/usr/bin/env node",
      'const {existsSync,writeFileSync}=require("node:fs")',
      'if(!existsSync('+JSON.stringify(marker)+')) {',
      ' writeFileSync('+JSON.stringify(marker)+',"")',
      ' writeFileSync("src/old.vibe","half written")',
      ' process.kill(process.pid,"SIGKILL")',
      '}',
      'console.log("vibelang --fix: 0 fixes in 0 files.")',
      ""
    ].join("\n"),{mode:0o755})
    await Jj.ensureRepo(repo)
    await must("jj config set --repo user.name test",{cwd:repo})
    await must("jj config set --repo user.email test@localhost",{cwd:repo})
    await Jj.commit(repo,"fixture")
    writeJson(paths(run).config,makeConfig({target:repo,test:"true",vibelangVersion:"0.0.0"}))
    writeJson(paths(run).plan,{batches:[{files:modules}]})
    let interrupted
    try { await codemod({run,batch:"01"}) } catch(error) { interrupted=error }
    assert.ok(interrupted,"the deliberately killed compiler must fail the first invocation")
    assert.ok(existsSync(marker),"the actual fake compiler must reach its controlled SIGKILL")
    const outside=readFileSync(join(repo,"src/old.vibe"),"utf8")
    let result,resumeError
    try { result=await codemod({run,batch:"01"}) } catch(error) { resumeError=error }
    assert.ifError(resumeError)
    assert.equal(outside,files["src/old.vibe"],"an interrupted fix preserves modules outside this batch")
    assert.deepEqual(result.renames,modules.map(from=>({from,to:from.replace(/\.ts$/,".vibe")})))
    for(const name of modules) assert.ok(existsSync(join(repo,name.replace(/\.ts$/,".vibe"))))
    assert.equal(readFileSync(join(repo,"package.json"),"utf8"),files["package.json"])
  } finally {
    rmSync(root,{recursive:true,force:true})
  }
}

test("t3code: an interrupted codemod resumes its prepared renames and preserves earlier modules",()=>inspect(corpus.input, true))
test("interrupted codemod recovery spans module count, directory depth and importer spelling",async()=>{
  await fc.assert(fc.asyncProperty(fc.record({
    count:fc.integer({min:1,max:5}),depth:fc.integer({min:0,max:2}),
    extension:fc.constantFrom(".ts",".js",""),
  }),inspect),{seed:211249,numRuns:20,endOnFailure:true})
})
