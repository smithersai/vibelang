import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixture, check } from "./record-verification-oracle.mjs"
import { assertParallelProperty } from "../../../../scripts/testing/parallel-property.mjs"
import { makeConfig, paths, record, report, verify } from "../lib/steps.mjs"
import { countTokens } from "../lib/tokens.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, slug, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json",import.meta.url))
const fc = require("fast-check")
const corpus = readJson(new URL("./corpus/foldkit-record-formatted-declarations.json",import.meta.url))


test("foldkit-13-record: verify certifies the formatted public declarations", async()=>{
  const contract=readFileSync(new URL("../README.md",import.meta.url),"utf8")
  assert.ok(contract.includes("Public declarations reachable from `exports` or `types` must remain API-identical"))
  await fixture(true,"createLazy",async({run,target,formatted})=>{
    const result=await verify({run,batch:"01"})
    assert.equal(readFileSync(join(target,"main.vibe"),"utf8"),formatted)
    assert.equal(result.ok,true)
    assert.equal(result.checks.declarations,true)
  })
})

test("foldkit-13-record: record rechecks a legacy receipt after formatting and refuses a changed API",async()=>{
  await fixture(true,"createLazy",async({run,p,target})=>{
    writeJson(p.verify("01"),{ok:true})
    await assert.rejects(record({run,batch:"01"}),/after formatting/)
    assert.equal(readJson(p.verify("01")).checks.declarations,false)
    assert.equal((await Jj.changedPaths(target)).length>0,true)
  },{...corpus,formattedDeclaration:corpus.formattedDeclaration.replaceAll("void","string")})
})

test("foldkit-13-record: generated signature names retain API gating and final token receipts", async () => {
  await assertParallelProperty(fc, {
    arbitraries: [fc.boolean(), fc.stringMatching(/^[a-z][a-z0-9]{0,7}$/), fc.constantFrom(corpus, ...corpus.neighbours)],
    oracle: check, module: new URL("./record-verification-oracle.mjs", import.meta.url),
    seed: 131013, numRuns: 40, asyncPredicate: true
  })
})

test("foldkit-13-record: formatter assertion mutations fail before certification, including force",async()=>{
  await fc.assert(fc.asyncProperty(fc.integer({min:2,max:99}),fc.boolean(),async(replacement,forced)=>{
    const guardTest={...corpus.formatterAssertions,after:corpus.formatterAssertions.before.replace("toBe(1)","toBe("+replacement+")")}
    await fixture(false,"createLazy",async({run,p,target})=>{
      writeJson(p.verify("01"),{ok:true})
      const base=await Jj.commitId(target,"@-")
      await assert.rejects(record({run,batch:"01",...(forced?{force:"regression control"}:{})}),new RegExp("forbidden test/fixture edits"))
      assert.deepEqual(readJson(p.verify("01")),{ok:true})
      assert.equal(await Jj.commitId(target,"@-"),base)
    },{...corpus,guardTest})
  }),{seed:131014,numRuns:12,examples:corpus.formatterAssertions.replacements.flatMap(n=>[[n,false],[n,true]])})
})


test("warning exceptions reach final module provenance, commit and report", async () => {
  await fixture(false, "retained", async ({ run, p, target }) => {
    const diagnostic = "main.vibe(1,9): warning EK4839: A match chain remains.\n  The handler is not an arrow function.\n"
    const compiler = join(target, "node_modules/.bin/vibelang")
    writeFileSync(compiler, readFileSync(compiler, "utf8") +
      '\nif (!process.argv.includes("--outDir")) console.log(' + JSON.stringify(diagnostic) + ');\n')
    writeJson(p.codemod("01"), { renames: [{ from: "main.ts", to: "main.vibe" }], fix: { refused: [], totals: {} } })
    const checked = await verify({ run, batch: "01" })
    assert.equal(checked.ok, true, JSON.stringify(checked))
    const exceptions = checked.files[0].warningExceptions
    assert.deepEqual(exceptions, [{
      name: "warning-retained", category: "warning", code: "EK4839",
      file: "main.vibe", line: 1, column: 9, message: "A match chain remains.",
      reason: "Warning retained for manual review."
    }])
    const recorded = await record({ run, batch: "01" })
    assert.deepEqual(recorded.files[0].warningExceptions, exceptions)
    assert.deepEqual(readJson(p.record("01")).files[0].warningExceptions, exceptions)
    const committed = await must('jj log --no-graph -r @- -T description', { cwd: target })
    // Jj.commit wraps long body lines; compare the description with its wrapping undone.
    const description = committed.stdout.replace(/\s+/g, " ")
    assert.ok(description.includes("Exception warning-retained: EK4839 main.vibe:1:9: " + exceptions[0].reason), committed.stdout)
    const reported = await report({ run })
    assert.deepEqual(reported.warningExceptions, exceptions.map(e => ({ batch: "01", ...e })))
    assert.ok(readFileSync(p.report, "utf8").includes(exceptions[0].reason))
  })
})
