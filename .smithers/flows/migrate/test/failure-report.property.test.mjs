import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { flowStep, paths, report } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"
const fc=createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))("fast-check")
const corpus=JSON.parse(readFileSync(new URL("./corpus/foldkit-baseline-failure-report.json",import.meta.url)))
async function check(input) {
  const run=mkdtempSync(join(tmpdir(),"migrate-failure-report-")),p=paths(run)
  try {
    const failed=input.failedNames
    const tests={code:input.code,total:input.passed+failed.length,passed:input.passed,failed:failed.length,failedNames:failed,skipped:0,newFailures:[],missing:[],baseline:{code:input.code,failed}}
    writeJson(p.config,{target:"fixture",packages:[{dir:"."}],toolchain:{kind:"npm",version:"0.0.11"}})
    writeJson(p.upgrade,{effect:{from:"4.0.0",to:"4.1.0"},jj:{commit:"abcdef123456"},changed:["package.json"],tests,regressions:{newFailures:[],missing:[]}})
    writeJson(p.setup,{compiler:{version:"test"},tests:{passed:input.passed,failed,skipped:0}})
    writeJson(p.plan,{batches:[{files:["src/main.ts"]}]})
    writeJson(p.codemod("01"),{fix:{totals:{},refused:[]}})
    writeJson(p.compile("01"),{})
    writeJson(p.repair("01"),{done:true})
    writeJson(p.verify("01"),{ok:true,files:[{path:"src/main.vibe",migrated:true}],tests,checks:{baselinePrepared:true,tests:true,declarations:true,style:true},declarations:{".":{identical:true}},compile:{style:[]}})
    const data=await report({run}),markdown=readFileSync(p.report,"utf8")
    const row=markdown.split("\n").find(line=>line.startsWith("| 01 |"))
    assert.ok(row)
    const label=row.split("|")[4].trim()
    const result=await flowStep("verify",{run})
    const upgrade=await flowStep("upgrade-effect",{run})
    if(input.code===0 && failed.length===0) {
      assert.match(label,/^pass\b/)
      assert.match(result.summary,/^pass:/)
      assert.match(upgrade.summary,/tests pass as before/)
    } else {
      assert.match(label,/^FAIL\b/,"a matching baseline is not a passing test command: "+row)
      assert.doesNotMatch(result.summary,/^pass:/)
      assert.match(result.summary,/fail/i)
      assert.match(upgrade.summary,/tests still FAIL/)
      assert.doesNotMatch(markdown,/the tests pass as before/)
      for(const name of failed) assert.ok(markdown.includes(name),"retain the actual failure name")
      assert.deepEqual(data.testFailures.map(f=>f.name),failed)
    }
  } finally {rmSync(run,{recursive:true,force:true})}
}
test("foldkit: an unchanged failing baseline is labelled as failing, with its names",async()=>check(corpus))
test("matching baseline reports retain actual command and assertion failures",async()=>{
  // Accepted prerequisite ruling: "do not ... report a delta-only comparison as a green package".
  await fc.assert(fc.asyncProperty(fc.constantFrom(0,1,2,128),fc.integer({min:0,max:12}),fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9 ]{0,12}$/),{minLength:0,maxLength:5}),async(code,passed,failedNames)=>check({code,passed,failedNames})),{seed:272097,numRuns:200})
})
