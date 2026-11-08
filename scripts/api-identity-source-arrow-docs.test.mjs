// TypeScript gives an arrow or function expression the JSDoc of the binding
// it initializes, and declaration emit prints that binding with a function
// type. The comparison reads that prose on the binding, not on its call
// signature, so a .ts source compared with the declarations tsc emits for it
// is identical. Prose written on the function itself, and a changed or
// removed binding comment, still differ.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Source-arrow documentation fixtures")
const ts = es5.ts
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-source-arrow-call-doc.json", import.meta.url), "utf8"))
const options = { lib: ["lib.es5.d.ts"], types: [], strict: true, target: ts.ScriptTarget.ES2022 }

// The declarations stock TypeScript emits for one source file.
function emit(source) {
  const root = mkdtempSync(join(tmpdir(), "api-arrow-emit-"))
  try {
    writeFileSync(join(root, "index.ts"), source)
    const program = ts.createProgram([join(root, "index.ts")], { ...options, declaration: true, emitDeclarationOnly: true, outDir: join(root, "out") })
    const diagnostics = ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
    assert.deepEqual(diagnostics, [], source)
    assert.equal(program.emit().emitSkipped, false)
    es5.assertLibraries()
    return readFileSync(join(root, "out", "index.d.ts"), "utf8")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function compare(source, header) {
  const root = mkdtempSync(join(tmpdir(), "api-arrow-"))
  try {
    mkdirSync(join(root, "before")); mkdirSync(join(root, "after"))
    writeFileSync(join(root, "before", "index.ts"), source)
    writeFileSync(join(root, "after", "index.d.ts"), header)
    const result = compareApiIdentity(ts, join(root, "before"), join(root, "after"),
      { beforeEntrypoints: { entry: "index.ts" }, afterEntrypoints: { entry: "index.d.ts" }, compilerOptions: options })
    es5.assertLibraries()
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const verdict = result => JSON.stringify({ identical: result.identical, complete: result.comparisonComplete,
  docs: result.docDifferences, names: result.nameDifferences, types: result.typeDifferences, environment: result.environmentDiagnostics })
function identical(source, header, label) {
  const result = compare(source, header)
  assert.equal(result.comparisonComplete, true, label + ": " + verdict(result))
  assert.equal(result.identical, true, label + ": " + verdict(result))
}
function matrix(cells) {
  const failures = []
  for (const [label, check] of cells) {
    try { check() } catch { failures.push(label) }
  }
  assert.deepEqual(failures, [], failures.length + " of " + cells.length + " cells fail")
}

// Bindings whose function value inherits the binding's JSDoc in TypeScript.
const hosts = {
  "const arrow": doc => doc + "export const f = (n: number): number => n + 1;\n",
  "let arrow": doc => doc + "export let f = (n: number): number => n + 1;\n",
  "function expression": doc => doc + "export const f = function (n: number): number { return n + 1; };\n",
  "named function expression": doc => doc + "export const f = function step(n: number): number { return n + 1; };\n",
  "generic arrow": doc => doc + "export const f = <T>(value: T): T => value;\n",
  "object property": doc => "export const o = {\n" + doc + "f: (n: number): number => n + 1,\n};\n",
  "class property": doc => "export class C {\n" + doc + "f = (n: number): number => n + 1;\n}\n",
}
const control = doc => doc + "export function f(n: number): number { return n + 1; }\n"
const docs = {
  "prose": "/** Retain this contract. */\n",
  "tags": "/**\n * Adds one.\n * @param n The input.\n * @returns The next number.\n */\n",
  "deprecated": "/** @deprecated Use another function. */\n",
  "multi-line": "/**\n * Prose on one line\n * and the next.\n */\n",
}

test("the t3code witness: a documented source arrow matches its declaration header", () => {
  identical(corpus.before, corpus.after, "corpus")
  assert.equal(emit(corpus.before), "/** Retain this contract. */\nexport declare const f: (n: number) => number;\n", "the corpus header is what tsc emits")
})

test("every inheriting binding matches what tsc emits for it, under each comment shape", () => {
  matrix(Object.entries(hosts).flatMap(([host, form]) => Object.entries(docs).map(([kind, doc]) => [host + " / " + kind, () => {
    const source = form(doc), header = emit(source)
    assert.ok(header.includes("/**"), "tsc keeps the binding comment: " + header)
    identical(source, header, host + " / " + kind)
  }])))
})

test("a function declaration, whose signature owns its comment, stays identical", () => {
  for (const [kind, doc] of Object.entries(docs)) identical(control(doc), emit(control(doc)), kind)
})

test("a changed or removed binding comment, and prose on the function itself, still differ", () => {
  for (const [host, form] of Object.entries(hosts)) {
    const source = form(docs.prose), header = emit(source)
    for (const [label, after] of [
      ["removed", header.replace("/** Retain this contract. */\n", "")],
      ["changed", header.replace("Retain this contract.", "Retain another contract.")],
    ]) {
      assert.notEqual(after, header, host + " " + label)
      const result = compare(source, after)
      assert.equal(result.identical, false, host + " " + label + ": " + verdict(result))
      assert.ok(result.docDifferences.length, host + " " + label + ": " + verdict(result))
    }
  }
  const inner = "export const f = /** Inner prose. */ (n: number): number => n + 1;\n"
  const result = compare(inner, emit(inner))
  assert.equal(result.identical, false, verdict(result))
  assert.ok(result.docDifferences.some(d => d.export.endsWith("#call0") && d.before.includes("Inner prose.")), verdict(result))
})

const words = fc.constantFrom("Adds", "one", "to", "the", "input", "value", "safely", "now")
test("property: tsc's own declarations match; changing one word of the binding prose does not", async () => {
  await checkProperty(fc, {
    name: "api-identity-source-arrow-docs",
    rule: corpus.rule + " A changed word of the binding prose still differs.",
    command: "node --test scripts/api-identity-source-arrow-docs.test.mjs",
    arbitrary: fc.record({
      host: fc.constantFrom(...Object.keys(hosts)),
      prose: fc.array(words, { minLength: 2, maxLength: 6 }),
      param: fc.boolean(),
      returns: fc.boolean(),
      deprecated: fc.boolean(),
    }),
    numRuns: 12,
    check: ({ host, prose, param, returns, deprecated }) => {
      const tags = [param && "@param n The input.", returns && "@returns The result.", deprecated && "@deprecated Use another."].filter(Boolean)
      const doc = "/**\n * " + prose.join(" ") + ".\n" + tags.map(tag => " * " + tag + "\n").join("") + " */\n"
      const source = hosts[host](doc), header = emit(source)
      identical(source, header, host + ": " + doc)
      const changed = header.replace(prose.join(" ") + ".", prose.join(" ") + " changed.")
      assert.notEqual(changed, header)
      const result = compare(source, changed)
      assert.equal(result.identical, false, host + " changed: " + verdict(result))
    },
  })
})
