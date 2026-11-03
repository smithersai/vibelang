import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = createRequire(import.meta.url)("typescript")
const design = process.env.SPEC_DESIGN_ROOT ?? fileURLToPath(new URL("../design", import.meta.url))
const files = ["src/000-intro.md", "src/001-functions.md", "src/003-failures.md",
  "src/005-services.md", "src/900-appendices.md", "vips/0009-service-declarations.md",
  "vips/0027-declaration-output.md", "vips/0032-effect-version.md",
  "vips/0041-throw-expressions.md", "vips/README.md", "vips/tc39-throw-expressions/spec.emu"]

function published() {
  return Object.fromEntries(files.map(file => {
    const path = !process.env.SPEC_DESIGN_ROOT && file.startsWith("src/")
      ? SpecPath(file.slice(4)) : join(design, file)
    return [file, existsSync(path) ? readFileSync(path, "utf8") : ""]
  }))
}

// These are consistency guards for the newly published claims. Before the
// simplified spec lands, the earlier chapters do not make those claims. The
// frozen witnesses below exercise every guard independently of publication.
function violations(key, source) {
  const text = path => source[path] ?? ""
  const failures = text("src/003-failures.md")
  const appendix = text("src/900-appendices.md")
  const problems = []
  const require = (condition, message) => { if (!condition) problems.push(message) }
  if (key === "OPUS-12" && /throw-expressions|Throw expressions|`throw` as an expression/.test(failures)) {
    require(/### ThrowExpression\b/.test(appendix), "missing throw-expression grammar")
    require(/ThrowExpressionInvalidPunctuator\s*=/.test(appendix), "missing punctuator production")
    require(/\| `EK1010` \|[^\n]*\| 41 \|/.test(appendix), "missing VIP-41 diagnostic")
    require(/^# VIP-41:/m.test(text("vips/0041-throw-expressions.md")), "missing unique VIP-41")
    require(/\[41\]\(0041-throw-expressions.md\)/.test(text("vips/README.md")), "missing VIP index")
    require(/ThrowExpressionInvalidPunctuator/.test(text("vips/tc39-throw-expressions/spec.emu")), "missing pinned snapshot")
    require(!/0040-throw-expressions/.test(failures), "VIP-40 collides with modules")
  }
  if (key === "OPUS-13" && text("src/005-services.md").includes("service Name: Type")) {
    require(/ServiceShapeDeclaration\s*=\s*ServiceStart TypeParameters\? ":" Type/.test(appendix), "missing whole-shape grammar")
    require(/ServiceShapeMember\s*=\s*KeyMember \| DefaultMember \| Member/.test(appendix), "missing body recovery grammar")
    for (const file of ["src/005-services.md", "vips/0009-service-declarations.md"]) {
      require(!text(file).includes("is the only way to declare a service"), `${file}: excludes the whole shape`)
      require(text(file).includes("the required body admits only the existing `key` and `defaultValue` members"), `${file}: missing body restriction`)
      if (file.startsWith("src/")) require(/\|[^\n]*service Name: Type[^\n]*\| `EK0902` \|/.test(text(file)), `${file}: missing body diagnostic`)
    }
  }
  if (key === "OPUS-14" && failures.includes("A written `@throws` or `@rethrows` tag in a `.vibe` file is `EK0406`")) {
    require(!failures.includes("Pending cleanup:"), "reserved process note remains normative")
    require(!failures.includes("A source `@rethrows` parameter still admits"), "retired source callback admission")
    require(failures.includes("Its callback parameters follow their written callable signatures"), "missing callback contract")
    require(/pin is `?effect`? 4\.1\.1/.test(text("vips/0032-effect-version.md")), "stale exact pin")
    for (const file of files.filter(file => file.startsWith("src/"))) {
      require(!text(file).includes("4.1.0"), `${file}: stale Effect version`)
    }
  }
  if (key === "ASTRA-5" && text("src/001-functions.md").includes("**API identity.**")) {
    for (const file of ["src/001-functions.md", "vips/0027-declaration-output.md"]) {
      require(text(file).includes("same doc comment on each export"), `${file}: lost comment identity`)
      require(text(file).includes("Construct the twin with the explicit `@throws {never}` contract"), `${file}: incomplete twin contract`)
    }
  }
  return problems
}

const keys = ["OPUS-12", "OPUS-13", "OPUS-14", "ASTRA-5"]
for (const key of keys) {
  test(`r16 ${key}: published chapter, grammar and VIP contracts agree`, () => {
    assert.deepEqual(violations(key, published()), [])
  })
}

// Minimized exact claims from 188ab3d6, rather than a second language oracle.
const frozen = {
  "OPUS-12": { "src/003-failures.md": "`throw` as an expression follows the TC39 throw-expressions proposal (`EK1010` reports its syntax restriction)." },
  "OPUS-13": { "src/005-services.md": "`service Name { members }` is the only way to declare a service.\n`service Name: Type { … }` supplies the exact whole Shape: its body permits only `key` and `defaultValue`." },
  "OPUS-14": { "src/003-failures.md": "A written `@throws` or `@rethrows` tag in a `.vibe` file is `EK0406`.\nPending cleanup: the next paragraph stays verbatim until the Effect 4.1.1 pin commit reaches main.\nA source `@rethrows` parameter still admits arbitrary throwing callbacks." },
  "ASTRA-5": {
    "src/001-functions.md": "**API identity.** The same doc comment on each export. A non-effectful exported function carries `@throws {never}`.",
    "vips/0027-declaration-output.md": "The same doc comment on each export. A non-effectful exported function carries `@throws {never}`."
  }
}

test("each frozen r16 witness is rejected by its own consistency guard", () => {
  for (const key of keys) assert.ok(violations(key, frozen[key]).length > 0, key)
})

test("r16 guards retain each defect across generated neighboring prose and whitespace", () => {
  fc.assert(fc.property(fc.constantFrom(...keys), fc.nat(30), fc.constantFrom("", "Unrelated prose.\n", "\n\n"), (key, count, padding) => {
    const source = Object.fromEntries(Object.entries(frozen[key]).map(([path, text]) => [path, padding.repeat(count) + text + padding]))
    assert.ok(violations(key, source).length > 0, key)
  }), { seed: 0x16cafe, numRuns: 200 })
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
  fc.assert(fc.property(summary, fc.boolean(), fc.constantFrom("function", "const", "call", "method", "constructor", "overloads"), (description, deprecated, form) => {
    const doc = `/** ${description}\n${deprecated ? " * @deprecated Use the replacement.\n" : ""} * @throws {never}\n */\n`
    const sources = {
      function: `${doc}export function read(value: number): number { return value }`,
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

test("OPUS-14: native async defaults and callbacks reject while foreign plain calls throw synchronously", async () => {
  const token = { failure: "native-async" }
  const throwing = () => { throw token }
  async function invoke(callback = throwing()) { return callback() }
  const arrow = async (callback = throwing()) => callback()
  const object = { async invoke(callback = throwing()) { return callback() } }
  for (const call of [invoke, arrow, object.invoke]) {
    for (const args of [[], [throwing]]) {
      let promise
      assert.doesNotThrow(() => { promise = call(...args) })
      await assert.rejects(promise, error => error === token)
    }
  }
  const plain = () => { throwing(); return Promise.resolve(0) }
  assert.throws(plain, error => error === token)
})
