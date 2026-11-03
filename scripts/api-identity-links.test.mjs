import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/foldkit-private-jsdoc-link.json", import.meta.url)))
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "api-link-"))
  try {
    for (const [side, text] of Object.entries({ before, after })) {
      const dir = join(root, side)
      mkdirSync(dir)
      const file = join(dir, "index.d.ts")
      writeFileSync(file, "export {};\n" + text)
      const program = ts.createProgram([file], { strict: true, noEmit: true, types: [] })
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.equal(diagnostics.length, 0, JSON.stringify(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText,"\n"))))
    }
    return compareApiIdentity(ts,join(root,"before"),join(root,"after"))
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
