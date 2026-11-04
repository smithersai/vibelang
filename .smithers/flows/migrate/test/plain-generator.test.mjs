import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { applyPlainEdits, markPlainFunctions, plainEdits } from "../lib/plain.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const quote = "A function's kind is decided by a keyword on the function, never by its body or by a type."
const generatorQuote = "A plain `function*` stays a JavaScript generator."
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-explicit-effects-generator-return-pin.json", import.meta.url), "utf8"))

function project(files, check) {
  const root = mkdtempSync(join(tmpdir(), "migrate-generator-"))
  try {
    symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "es2022", module: "nodenext", moduleResolution: "nodenext",
      strict: true, types: [], skipLibCheck: true
    } }))
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text)
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("TestGeneratorPlainModelQuoted", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote))
  assert.ok(readFileSync(SpecPath("002-running.md"), "utf8").includes(generatorQuote))
})

test("plain-by-syntax leaves generator declarations, expressions and methods unwritten", () => {
  const source = [
    "export function* values() { yield 1; return 2 }",
    "export const expression = function* named() { yield 3 }",
    "export const object = { *values() { yield 4 } }",
    "export class Values { static *values() { yield 5 } *items() { yield 6 } }",
    "export function outer() { function* inner() { yield 7 } return inner() }",
    "export async function* later() { yield 8 }",
    "export function* written(): Generator<number, void, unknown> { yield 9 }",
    ""
  ].join("\n")
  project({ "m.ts": source }, root => {
    const result = markPlainFunctions(ts, root, ["m.ts"], ["tsconfig.json"], { flipped: true })
    assert.equal(readFileSync(join(root, "m.ts"), "utf8"), source)
    assert.deepEqual(result, {})
  })
})

test("t3code generator contract: prepare and replay preserve source annotations", () => {
  project(corpus.files, root => {
    const files = Object.keys(corpus.files)
    const state = prepareState(root, files, files, { ts, plainGroups: [{ files, tsconfigs: ["tsconfig.json"], flipped: true }] })
    assert.equal(state.functionModel, "plain-by-syntax")
    assert.deepEqual(state.plain, {}, corpus.key)
    for (const [file, text] of Object.entries(corpus.files)) assert.equal(readFileSync(join(root, file), "utf8"), text)
    applyState(root, state)
    applyState(root, state)
    for (const [file, text] of Object.entries(corpus.files)) {
      assert.equal(readFileSync(join(root, file.replace(/\.ts$/, ".vibe")), "utf8"), text.replace("./contract.js", "./contract.vibe"), corpus.key)
    }
  })
})

test("plain-by-syntax neither prints unavailable inferred generator types nor reports legacy leftovers", () => {
  const sf = ts.createSourceFile("m.ts", "export function* values() { yield value }", ts.ScriptTarget.Latest, true)
  const returned = { flags: 0, isUnion: () => false }
  const checker = {
    getSignatureFromDeclaration: () => ({}), getReturnTypeOfSignature: () => returned,
    getApparentType: type => type, getPropertiesOfType: () => [],
    typeToString: () => 'Generator<import("./private.js").Value, void, unknown>'
  }
  assert.deepEqual(plainEdits(ts, checker, sf, { flipped: true }), { edits: [], left: [] })
  assert.deepEqual(plainEdits(ts, checker, sf), { edits: [], left: [1] })
})

test("property: generator annotations stay unchanged under plain-by-syntax", () => {
  const shape = fc.constantFrom(
    body => `export function* values() { ${body} }`,
    body => `export const values = function* named() { ${body} }`,
    body => `export const object = { *values() { ${body} } }`,
    body => `export class Values { static *values() { ${body} } }`,
    body => `export function outer() { function* values() { ${body} } return values() }`
  )
  fc.assert(fc.property(shape, fc.integer(), fc.constantFrom("number", "string", "unknown", "any"), fc.boolean(), (render, value, type, written) => {
    const original = render(`yield ${value}; return ${value}`) + "\n"
    const source = written ? original.replace("values()", `values(): Generator<${type}, number, unknown>`) : original
    const sf = ts.createSourceFile("m.ts", source, ts.ScriptTarget.Latest, true)
    // Inferred yields/returns cannot decide a function's kind (VIP-1).
    const returned = { flags: 0, isUnion: () => false }
    const checker = {
      getSignatureFromDeclaration: () => ({}), getReturnTypeOfSignature: () => returned,
      getApparentType: t => t, getPropertiesOfType: () => [],
      typeToString: () => `Generator<${type}, number, unknown>`
    }
    const result = plainEdits(ts, checker, sf, { flipped: true })
    assert.equal(applyPlainEdits(source, result.edits), source)
    assert.deepEqual(result.left, [])
  }), { seed: 2701, numRuns: 160 })
})
