import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-private-jsdoc-link.json", import.meta.url)))
const libraries = createEs5FixtureGuard(loadTypeScript(), "JSDoc link fixtures")
const ts = libraries.ts
const options = { lib: ["lib.es5.d.ts"], strict: true, noEmit: true, types: [] }
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function compare(before, after, expectedDiagnostics = []) {
  const root = mkdtempSync(join(tmpdir(), "api-link-"))
  try {
    for (const [side, text] of Object.entries({ before, after })) {
      const dir = join(root, side)
      mkdirSync(dir)
      const file = join(dir, "index.d.ts")
      writeFileSync(file, "export {};\n" + text)
      const program = ts.createProgram([file], options)
      libraries.assertLibraries()
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.deepEqual(diagnostics.map(d => d.code), expectedDiagnostics,
        JSON.stringify(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))))
    }
    const result = compareApiIdentity(ts,join(root,"before"),join(root,"after"), { compilerOptions: options })
    libraries.assertLibraries()
    return result
  } finally { rmSync(root, {recursive:true,force:true}) }
}
const declaration = (kind, target="Ref", label="", place="export") => {
  const comment = `/** Pair it with {@${kind} ${target}${label ? " " + label : ""}}. */`
  return place === "member" ? `export interface X {\n ${comment}\n value: string\n}`
    : place === "tag" ? `/** @see {@${kind} ${target}${label ? " " + label : ""}} */\nexport interface X {value:string}`
    : `${comment}\nexport interface X {value:string}`
}
test("JSDoc links retain their meaning when only the target's private binding changes", () => {
  assert.equal(compare(corpus.before, corpus.after).identical, true)
  for (const kind of ["link", "linkcode", "linkplain"]) {
    for (const place of ["export", "member", "tag"]) {
      const text = declaration(kind,"Ref","",place)
      const result = compare(text,"declare const Ref: unknown;\n"+text)
      assert.equal(result.identical,true,JSON.stringify(result))
      const mutation = compare(text,declaration(kind,"Other","",place))
      assert.equal(mutation.identical,false)
      assert.ok(mutation.docDifferences.length,JSON.stringify(mutation))
    }
  }
})
test("property: private link resolution cannot change an exported comment", async () => {
  await checkProperty(fc, {
    name:"api-identity-jsdoc-link-resolution",
    rule:"Will: doc comments are compared with formatting ignored; resolving a private link target cannot change identical source comment text",
    command:"node --test scripts/api-identity-links.test.mjs",
    arbitrary:fc.record({kind:fc.constantFrom("link","linkcode","linkplain"),place:fc.constantFrom("export","member","tag"),label:fc.constantFrom("","label","read this","|label","|read this"),reverse:fc.boolean()}),
    numRuns:24,
    check:({kind,place,label,reverse})=>{
      const text=declaration(kind,"Ref",label,place), resolved="declare const Ref: unknown;\n"+text
      const result=reverse?compare(resolved,text):compare(text,resolved)
      assert.equal(result.identical,true,JSON.stringify(result))
      const mutation=compare(text,declaration(kind,"Other",label,place))
      assert.equal(mutation.identical,false)
      assert.ok(mutation.docDifferences.length,JSON.stringify(mutation))
    },
  })
})

test("link labels and rendering kinds remain part of exported documentation", () => {
  for (const after of [declaration("link", "Ref", "second label"), declaration("linkcode", "Ref", "first label")]) {
    const result = compare(declaration("link", "Ref", "first label"), after)
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.docDifferences.length, JSON.stringify(result))
  }
})


test("linked declarations retain native structural type mutations", () => {
  for (const place of ["export", "member", "tag"]) {
    const before = declaration("link", "Ref", "same label", place)
    const result = compare(before, before.replace("value: string", "value: number").replace("value:string", "value:number"))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.typeDifferences.length, JSON.stringify(result))
    assert.deepEqual(result.docDifferences, [])
  }
})

test("link fixtures keep missing native libraries invalid", () => {
  const source = declaration("link") + "\nexport declare const unavailable: BigInt;"
  const result = compare(source, source, [2583])
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2583/.test(d.diagnostic)), JSON.stringify(result))
})
