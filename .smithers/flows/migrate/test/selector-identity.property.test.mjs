import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, globSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import * as selectors from "../lib/source-paths.mjs"
import { prepareState } from "../lib/codemod-state.mjs"
import { repairPrompt } from "../lib/repair.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-docpage-selector-identity.json", import.meta.url)))
const renames = [{ from: "page/demo.ts", to: "page/demo.vibe" }]
test("foldkit-67: refuses a selector that silently adds an existing native page", () => {
  const result = selectors.rewriteSourceLiterals(ts, corpus.text, corpus.file, renames, { inventory: corpus.files })
  assert.equal(result.text, corpus.text)
  assert.equal(result.edits.length, 0)
  assert.match(result.warnings.join("\n"), /selected set/)
})
test("source-selector receipt retains exact before/after names and exposes them for review", () => {
  const result = selectors.rewriteSourceLiterals(ts, corpus.text, corpus.file, renames, { inventory: ["page/demo.ts", "page/companion.ts", "src/docPage.test.ts"] })
  assert.equal(result.edits.length, 1)
  assert.equal(result.selectorChecks[0].pass, true)
  const proof = result.selectorChecks[0].contexts.find(c => c.base === "src")
  assert.deepEqual(proof.before, ["page/companion.ts", "page/demo.ts"])
  assert.deepEqual(proof.mapped, proof.before)
  assert.equal(proof.beforeCount, proof.afterCount)
  const prompt = repairPrompt({ context:"context",run:"run",batch:"01",target:"repo",packages:["."],test:"true",files:[],step:"step",compile:{diagnostics:[],newErrors:[]},codemod:{fix:{byFile:{},refused:[]},selectorChecks:result.selectorChecks} })
  assert.match(prompt, /Selected-set identity/)
  assert.ok(prompt.includes("page/companion.ts"))
})
test("a complete inventory is required even when the single renamed witness matches", () => {
  const result = selectors.rewriteSourceLiterals(ts, corpus.text, corpus.file, renames)
  assert.equal(result.text, corpus.text)
  assert.equal(result.edits.length, 0)
})
test("generated inventories agree with actual Node glob selected identities and sidecar exclusion", () => {
  fc.assert(fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), {minLength:1,maxLength:8}), fc.boolean(), (names, extra) => {
    const moves = names.filter((_,i) => i % 2 === 0).map(name => ({from:"src/" + name + ".ts",to:"src/" + name + ".vibe"}))
    const inventory = names.map(name => "src/" + name + ".ts").concat(extra ? ["src/native-only.vibe"] : [])
    const text = 'const pages = import.meta.glob("src/**/*.ts")'
    const result = selectors.rewriteSourceLiterals(ts,text,"collector.ts",moves,{inventory})
    assert.equal(result.edits.length, extra ? 0 : 1)
    if (extra) return
    const root = mkdtempSync(join(tmpdir(),"migrate-selector-proof-"))
    try {
      for(const file of inventory) {mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),"")}
      const before = [...globSync("src/**/*.ts",{cwd:root})].sort()
      for(const move of moves) {rmSync(join(root,move.from));writeFileSync(join(root,move.to),"");writeFileSync(join(root,move.to.replace(/\.vibe$/,".d.vibe.ts")),"")}
      const after = [...globSync(result.edits[0].to,{cwd:root})].map(file => moves.find(move=>move.to===file)?.from ?? file).sort()
      assert.deepEqual(after,before)
      assert.equal(result.selectorChecks[0].pass,true)
    } finally {rmSync(root,{recursive:true,force:true})}
  }),{seed:67272,numRuns:150})
})
test("durable codemod checks the whole tracked catalog without scanning its source text", () => {
  const root=mkdtempSync(join(tmpdir(),"migrate-selector-catalog-"))
  try {
    const put=(file,text)=>{mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),text)}
    put("package.json",'{"type":"module"}')
    put("page/demo.ts","export const demo=1")
    put(corpus.file,corpus.text)
    put("page/already.vibe","export const prior=1")
    const state=prepareState(root,["page/demo.ts"],["page/demo.ts",corpus.file,"page/already.vibe"],{ts,references:[corpus.file],catalog:corpus.files})
    assert.equal(state.referenceEdits.length,0)
    assert.equal(state.selectorChecks.some(proof=>!proof.pass),true)
    assert.equal(state.referenceScan.files,1)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test("verify refuses missing proofs and inventory growth after a selector rewrite", () => {
  const catalog = ["page/demo.ts", corpus.file]
  const result = selectors.rewriteSourceLiterals(ts,corpus.text,corpus.file,renames,{inventory:catalog})
  const receipt = {renames,referenceEdits:result.edits,selectorChecks:result.selectorChecks}
  assert.equal(selectors.checkSelectorEdits(receipt,["page/demo.vibe",corpus.file]).every(c=>c.pass),true)
  assert.equal(selectors.checkSelectorEdits({...receipt,selectorChecks:[]},catalog).every(c=>c.pass),false)
  for(const extra of ["page/new.ts","page/new.vibe"]) assert.equal(selectors.checkSelectorEdits(receipt,catalog.concat(extra)).every(c=>c.pass),false)
})

// VIP-33 selector rewrites preserve exact identities over the approved companion inventory; rule: docs/design/vips/0033-platform-stdlib.md#d32d71473414a82e

// VIP-33 selector rewrites preserve exact identities over the approved companion inventory; rule: docs/design/vips/0033-platform-stdlib.md#8b2d712bc64db4a4

// VIP-33 selector rewrites preserve exact identities over the approved companion inventory; rule: docs/design/vips/0033-platform-stdlib.md#223bf720dc903fbb

// VIP-33 selector rewrites preserve exact identities over the approved companion inventory; rule: docs/design/vips/0033-platform-stdlib.md#f947873de36e623c

// VIP-33 selector rewrites preserve exact identities over the approved companion inventory; rule: docs/design/vips/0033-platform-stdlib.md#0fb001e3bf0e877c
