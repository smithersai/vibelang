import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import test from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const compilerOptions = { lib: ["lib.es5.d.ts"] }
const stockTs = loadTypeScript()
const unexpectedLibraries = new Set()
const ts = { ...stockTs, createProgram(...args) {
  const program = stockTs.createProgram(...args)
  const libraries = program.getSourceFiles().map(source => source.fileName)
    .filter(file => /[/\\]lib\.[^/\\]+\.d\.ts$/.test(file))
  if (!libraries.some(file => /[/\\]lib\.es5\.d\.ts$/.test(file))) unexpectedLibraries.add("missing ES5")
  for (const file of libraries) {
    if (!/[/\\]lib\.(?:es5|decorators(?:\.legacy)?)\.d\.ts$/.test(file)) unexpectedLibraries.add(basename(file))
  }
  return program
} }
function assertLibraries() {
  assert.deepEqual([...unexpectedLibraries].sort(), [], "Generated-contract fixtures must load only ES5 and decorator libraries")
}
function compareDeclarations(a, b, comparisonOptions = {}) {
  const result = compareApiIdentity(ts, a, b, { ...comparisonOptions, compilerOptions })
  assertLibraries()
  return result
}
function compare(before, after) {
 const root = mkdtempSync(join(tmpdir(), "vip27-docs-"))
 try {
  for (const [side, text] of Object.entries({before, after})) {
   mkdirSync(join(root, side))
   writeFileSync(join(root, side, "index.d.ts"), text)
   const program = ts.createProgram([join(root, side, "index.d.ts")], {
    ...compilerOptions, strict: true, noEmit: true, types: [],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
   })
   assertLibraries()
   assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [],
    "stock TypeScript accepts every documentation fixture")
  }
  return compareDeclarations(join(root, "before"), join(root, "after"))
 } finally { rmSync(root, {recursive:true, force:true}) }
}
const forms = [
 doc => doc + "\nexport declare function sample(): number;",
 doc => doc + "\nexport declare const sample: () => number;",
 doc => "export declare class Sample {\n" + doc + "\nmethod(): number; }",
 doc => "export declare const sample: {\n" + doc + "\nmethod(): number; };",
 doc => "export interface Sample {\n" + doc + "\nmethod(): number; }",
 doc => doc + "\nexport declare function sample(n: string): number;\n" + doc + "\nexport declare function sample(n: number): number;",
 doc => "export interface Sample {\n" + doc + "\n(): number; }",
 doc => "export interface Sample {\n" + doc + "\nnew(): object; }",
 doc => "export type Sample = " + doc + "\n() => number;",
 doc => "export interface Sample { callback: " + doc + "\n() => number; }",
 doc => "/** Parent documentation. */\nexport declare function sample(callback: " + doc + "\n() => number): number;",
]
for (const [i, form] of forms.entries()) {
 test("VIP-27 generated tag is the only allowed addition: form " + i, () => {
  const result = compare(form("/** Keeps its docs. @deprecated old */"), form("/** Keeps its docs. @deprecated old\n * @throws {never} */"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
 })
}
for (const [label, before, after] of [
 ["authored unknown changed", "/** @throws {unknown} */", "/** @throws {never} */"],
 ["authored never changed", "/** @throws {never} */", "/** @throws {unknown} */"],
 ["authored never removed", "/** @throws {never} */", ""],
 ["extra tag", "", "/** @throws {never}\n * @deprecated new */"],
 ["prose changed", "/** old */", "/** new\n * @throws {never} */"],
 ["not generated", "", "/** @throws {unknown} */"],
 ["description on throws", "", "/** @throws {never} extra */"],
 ["duplicate throws", "", "/** @throws {never}\n * @throws {never} */"],
 ["authored throws without type", "/** @throws on failure */", "/** @throws {never} */"],
]) {
 test("VIP-27 rejects " + label, () => {
  const result = compare(forms[0](before), forms[0](after))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.docDifferences.length, JSON.stringify(result))
 })
}
test("VIP-27 cannot add throws to non-callable data", () => {
 const result = compare("export declare const sample: number;", "/** @throws {never} */\nexport declare const sample: number;")
 assert.equal(result.identical, false, JSON.stringify(result))
})

test("VIP-27 still checks documentation on each callable type signature", () => {
 for (const form of forms.slice(6)) {
  const result = compare(form("/** @throws {unknown} */"), form("/** @throws {never} */"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify({form:forms.indexOf(form),result}))
  assert.ok(result.docDifferences.length, JSON.stringify(result))
 }
})

test("VIP-27 cannot add a contract to the class comment", () => {
 const result = compare("export declare class Sample {}", "/** @throws {never} */\nexport declare class Sample {}")
 assert.equal(result.identical, false, JSON.stringify(result))
})
test("VIP-27 supports optional method signatures", () => {
 const result = compare("export interface Sample { method?(): number; }", "export interface Sample {\n/** @throws {never} */\nmethod?(): number; }")
 assert.equal(result.identical, true, JSON.stringify(result))
})

test("VIP-27 checks inline contracts even beside parent documentation", () => {
 for (const form of [
  doc => "/** Parent documentation. */\nexport type Sample = " + doc + "\n() => number;",
  doc => "export interface Sample {\n/** Property documentation. */\ncallback: " + doc + "\n() => number; }",
 ]) {
  const result = compare(form("/** @throws {unknown} */"), form("/** @throws {never} */"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
 }
})
test("VIP-27 rejects duplicate and extra inline tags", () => {
 for (const doc of ["/** @throws {never}\n * @throws {never} */", "/** @throws {never}\n * @deprecated new */"]) {
  const result = compare(forms[8](""), forms[8](doc))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
 }
})

test("VIP-27 adds an own contract without changing inherited parent documentation", () => {
 for (const form of [
  doc => "/** Alias documentation. */\nexport type Sample = " + doc + "() => number;",
  doc => "export declare class Sample {\n/** Getter documentation. */\nget callback(): " + doc + "() => number; }",
  doc => "/** Class documentation. */\nexport declare class Sample {\n" + doc + "constructor(); }",
  doc => "/** @param callback The callback. */\nexport declare function sample(callback: " + doc + "() => number): number;",
 ]) {
  const result = compare(form(""), form("/** @throws {never} */\n"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
 }
})

test("VIP-27 keeps a callable binding's inherited prose beside an inline contract", () => {
 for (const form of [
  doc => "/** Binding documentation. */\nexport declare const sample: " + doc + "(value: unknown) => value is number;",
  doc => "export interface Sample {\n/** Property documentation. */\ncallback: " + doc + "() => number; }",
 ]) {
  const result = compare(form(""), form("/** @throws {never} */\n"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
  const changed = compare(form(""), form("/** Changed prose.\n * @throws {never} */\n"))
  assert.equal(changed.identical, false, JSON.stringify(changed))
 }
})

test("VIP-27 rejects duplicated authored prose blocks", () => {
 for (const form of [forms[0],forms[1],forms[3]]) {
  const result=compare(form("/** Keeps one authored block. */"),form("/** Keeps one authored block.\n * @throws {never} */\n/** Keeps one authored block. */"))
  assert.equal(result.comparisonComplete,true,JSON.stringify(result))
  assert.equal(result.identical,false,JSON.stringify(result))
  assert.ok(result.docDifferences.length,JSON.stringify(result))
 }
})
