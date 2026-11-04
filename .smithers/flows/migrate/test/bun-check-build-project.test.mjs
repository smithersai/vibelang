import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
import {addCompilerScripts,replaceTsc} from "../lib/wire.mjs"

test("opencode Core build project selector becomes a positional TypeScript project",()=>{
  const corpus=JSON.parse(readFileSync(new URL("./corpus/opencode-core-bun-build-project.json",import.meta.url)))
  const original={scripts:{typecheck:corpus.script}}
  const next=addCompilerScripts(original,"file:compiler.tgz")
  assert.equal(next.scripts.typecheck,corpus.expected)
  assert.deepEqual(addCompilerScripts(next,"file:compiler.tgz"),next)
  assert.equal(original.scripts.typecheck,corpus.script)
})
test("build project selectors preserve literal tokens and put build mode first",()=>{
  for(const build of ["-b","--build"])
    for(const project of ["-p","--project"]){
      assert.equal(replaceTsc({typecheck:"echo before && bun check --no-script "+build+" "+project+" 'config -p project.json' --noEmit && echo after"}).typecheck,
        "echo before && vibelang "+build+" 'config -p project.json' --noEmit && echo after")
      assert.equal(replaceTsc({typecheck:"bun check --no-script "+project+" \"config --project name.json\" "+build+" --noEmit"}).typecheck,
        "vibelang "+build+" \"config --project name.json\" --noEmit")
      assert.equal(replaceTsc({typecheck:"bun check --no-script "+build+" "+project+" test\\ project.json"}).typecheck,
        "vibelang "+build+" test\\ project.json")
    }
})

test("Bun build flags without a TypeScript build equivalent keep the native command",()=>{
  for(const script of [
    "bun check --no-script -b -p tests.json --strict",
    "bun check --no-script --build -p tests.json --skipLibCheck",
    "bun check --no-script -b -p first.json --project last.json",
    "bun check --no-script -b --build -p tests.json",
  ])assert.equal(replaceTsc({typecheck:script}).typecheck,script)
})
