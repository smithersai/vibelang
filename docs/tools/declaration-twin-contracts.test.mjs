import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = createRequire(import.meta.url)("typescript")

test("Chapter 001 requires a contract-complete TypeScript twin", () => {
  const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")
  assert.ok(chapter.includes("Construct the twin with the explicit `@throws {never}` contract on each non-effectful signature for which VibeLang emits it."))
  assert.ok(chapter.includes("Preserve the source documentation and add that tag to the twin's JSDoc before running `tsc`"))
})

function declaration(source) {
  const result = ts.transpileDeclaration(source, {
    fileName: "twin.ts",
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
    reportDiagnostics: true
  })
  assert.deepEqual(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [])
  return result.outputText
}

test("ASTRA-5: native TypeScript distinguishes an unannotated and contract-complete add twin", () => {
  const source = "export function add(a: number, b: number): number { return a + b }"
  const raw = declaration(source)
  const tagged = declaration("/** @throws {never} */\n" + source)
  assert.doesNotMatch(raw, /@throws/)
  assert.match(tagged, /@throws \{never\}/)
  assert.equal(tagged.replace(/\/\*\* @throws \{never\} \*\/\s*/, ""), raw)
})

test("ASTRA-5: tsc preserves explicit never contracts and documentation across signature forms", () => {
  const summary = fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz "), { minLength: 1, maxLength: 40 }).map(chars => chars.join(""))
  fc.assert(fc.property(summary, fc.boolean(), fc.constantFrom("function", "async", "async-arrow", "const", "call", "method", "constructor", "overloads"), (description, deprecated, form) => {
    const doc = `/** ${description}\n${deprecated ? " * @deprecated Use the replacement.\n" : ""} * @throws {never}\n */\n`
    const sources = {
      function: `${doc}export function read(value: number): number { return value }`,
      async: `${doc}export async function read(value: number): Promise<number> { return value }`,
      "async-arrow": `${doc}export const read = async (value: number): Promise<number> => value`,
      const: `${doc}export const read: (value: number) => number = value => value`,
      call: `export interface Reader {\n${doc}(value: number): number }`,
      method: `export class Reader {\n${doc}read(value: number): number { return value } }`,
      constructor: `export class Reader {\n${doc}constructor(readonly value: number) {} }`,
      overloads: `${doc}export function read(value: number): number;\n${doc}export function read(value: string): string;\nexport function read(value: number | string): number | string { return value }`
    }
    const output = declaration(sources[form])
    assert.equal((output.match(/@throws \{never\}/g) ?? []).length, form === "overloads" ? 2 : 1, output)
    assert.equal(output.includes("@deprecated"), deprecated)
    assert.ok(output.includes(description.trim()))
  }), { seed: 0x27cafe, numRuns: 200 })
})

test("t3code Mobile: generated never metadata requires a contract-complete twin", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/t3code-mobile-generated-throws-never.json", import.meta.url), "utf8"))
  const raw = declaration("/** " + fixture.authoredDoc + " */\n" + fixture.signature)
  const twin = declaration("/** " + fixture.authoredDoc + "\n * @throws {never}\n */\n" + fixture.signature)
  assert.ok(raw.includes(fixture.authoredDoc))
  assert.doesNotMatch(raw, /@throws/)
  assert.match(twin, /@throws \{never\}/)
  assert.ok(twin.includes(fixture.authoredDoc))
  assert.notEqual(raw, twin, "the additional cross-module contract must remain visible")
  const withoutContract = twin.replace(/\n\s*\* @throws \{never\}/, "")
  assert.equal(withoutContract.replace(/\s+/g, " ").trim(), raw.replace(/\s+/g, " ").trim())
})
