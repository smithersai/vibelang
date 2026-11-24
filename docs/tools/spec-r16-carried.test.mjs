import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../scripts/testing/spec-path.mjs"

const design = process.env.SPEC_DESIGN_ROOT ?? fileURLToPath(new URL("../design", import.meta.url))
const files = ["src/000-intro.md", "src/001-functions.md", "src/003-failures.md",
  "src/005-services.md", "src/900-appendices.md", "vips/0009-service-declarations.md",
  "vips/0027-declaration-output.md", "vips/0032-effect-version.md",
  "vips/0041-throw-expressions.md", "vips/README.md", "vips/tc39-throw-expressions/spec.emu"]

function published() {
  return Object.fromEntries(files.map(file => {
    const path = !process.env.SPEC_DESIGN_ROOT && file.startsWith("src/")
      ? SpecPath(file.slice(4)) : join(design, file)
    return [file, readFileSync(path, "utf8")]
  }))
}

// Consistency guards for the published rules and their grammar and VIP references.
function violations(key, source) {
  const text = path => source[path] ?? ""
  const failures = text("src/003-failures.md")
  const appendix = text("src/900-appendices.md")
  const problems = []
  const require = (condition, message) => { if (!condition) problems.push(message) }
  if (key === "throw expressions") {
    require(/throw-expressions|Throw expressions|`throw` as an expression/.test(failures), "missing throw-expression claim")
    require(/### ThrowExpression\b/.test(appendix), "missing throw-expression grammar")
    require(/ThrowExpressionInvalidPunctuator\s*=/.test(appendix), "missing punctuator production")
    require(/\| `EK1010` \|[^\n]*\| 41 \|/.test(appendix), "missing VIP-41 diagnostic")
    require(/^# VIP-41:/m.test(text("vips/0041-throw-expressions.md")), "missing unique VIP-41")
    require(/\[41\]\(0041-throw-expressions.md\)/.test(text("vips/README.md")), "missing VIP index")
    require(/ThrowExpressionInvalidPunctuator/.test(text("vips/tc39-throw-expressions/spec.emu")), "missing pinned snapshot")
    require(!/0040-throw-expressions/.test(failures), "VIP-40 collides with modules")
  }
  if (key === "whole-shape services") {
    require(text("src/005-services.md").includes("service Name: Type"), "missing whole-shape service claim")
    require(/ServiceDeclaration\s*=[\s\S]*?\|\s*ServiceStart TypeParameters\? ":" Type "\{" \(ServiceMember Separator\)\* "\}"/.test(appendix), "missing whole-shape grammar")
    require(/only KeyMember and DefaultMember are admitted; other members parse for EK0902/.test(appendix), "missing body recovery grammar")
    for (const file of ["src/005-services.md", "vips/0009-service-declarations.md"]) {
      require(!text(file).includes("is the only way to declare a service"), `${file}: excludes the whole shape`)
      require(/[Tt]he required body admits only the existing `key` and `defaultValue` members/.test(text(file)), `${file}: missing body restriction`)
      if (file.startsWith("src/")) require(/\|[^\n]*service Name: Type[^\n]*\| `EK0902` \|/.test(text(file)), `${file}: missing body diagnostic`)
    }
  }
  if (key === "throw contracts") {
    require(/A written `@throws` or `@rethrows` tag (?:there|in a `\.vibe` file)[^\n]*`EK0406`/.test(failures), "missing written-tag diagnostic rule")
    require(!failures.includes("Pending cleanup:"), "reserved process note remains normative")
    require(!failures.includes("A source `@rethrows` parameter still admits"), "retired source callback admission")
    require(failures.includes("Its callback parameters follow their written callable signatures"), "missing callback contract")
    require(/pin is `?effect`? 4\.1\.1/.test(text("vips/0032-effect-version.md")), "stale exact pin")
    for (const file of files.filter(file => file.startsWith("src/"))) {
      require(!text(file).includes("4.1.0"), `${file}: stale Effect version`)
    }
  }
  if (key === "API identity") {
    require(text("src/001-functions.md").includes("**API identity.**"), "missing API identity claim")
    for (const file of ["src/001-functions.md", "vips/0027-declaration-output.md"]) {
      require(text(file).includes("same doc comment on each export"), `${file}: lost comment identity`)
      const exception = file.startsWith("src/")
        ? "the emitted declaration may add VIP-27’s generated `@throws {never}` contract where the twin has no authored throw contract"
        : "The emitted declaration may add exactly the generated `@throws {never}` contract where the twin has no authored throw contract."
      require(text(file).includes(exception), `${file}: missing generated-contract exception`)
      require(text(file).includes(file.startsWith("src/") ? "an authored `@throws` must remain unchanged" : "Changing or removing an authored `@throws`"), `${file}: missing authored-contract preservation`)
    }
  }
  return problems
}

const keys = ["throw expressions", "whole-shape services", "throw contracts", "API identity"]
for (const key of keys) {
  test(`${key}: published chapter, grammar and VIP contracts agree`, () => {
    assert.deepEqual(violations(key, published()), [])
  })
}

test("API identity guards reject a lost exception or authored contract independently", () => {
  const current = published()
  for (const file of ["src/001-functions.md", "vips/0027-declaration-output.md"]) {
    for (const phrase of ["where the twin has no authored throw contract", "an authored `@throws`"]) {
      const changed = { ...current, [file]: current[file].replace(phrase, "changed contract") }
      assert.ok(violations("API identity", changed).length > 0, file + ": " + phrase)
    }
  }
})

// Minimized exact claims from 188ab3d6, rather than a second language oracle.
const frozen = {
  "throw expressions": { "src/003-failures.md": "`throw` as an expression follows the TC39 throw-expressions proposal (`EK1010` reports its syntax restriction)." },
  "whole-shape services": { "src/005-services.md": "`service Name { members }` is the only way to declare a service.\n`service Name: Type { … }` supplies the exact whole Shape: its body permits only `key` and `defaultValue`." },
  "throw contracts": { "src/003-failures.md": "A written `@throws` or `@rethrows` tag in a `.vibe` file is `EK0406`.\nPending cleanup: the next paragraph stays verbatim until the Effect 4.1.1 pin commit reaches main.\nA source `@rethrows` parameter still admits arbitrary throwing callbacks." },
  "API identity": {
    "src/001-functions.md": "**API identity.** The same doc comment on each export. A non-effectful exported function carries `@throws {never}`.",
    "vips/0027-declaration-output.md": "The same doc comment on each export. A non-effectful exported function carries `@throws {never}`."
  }
}

test("each frozen witness is rejected by its own consistency guard", () => {
  for (const key of keys) assert.ok(violations(key, frozen[key]).length > 0, key)
})

test("consistency guards retain each defect across generated neighboring prose and whitespace", () => {
  fc.assert(fc.property(fc.constantFrom(...keys), fc.nat(30), fc.constantFrom("", "Unrelated prose.\n", "\n\n"), (key, count, padding) => {
    const source = Object.fromEntries(Object.entries(frozen[key]).map(([path, text]) => [path, padding.repeat(count) + text + padding]))
    assert.ok(violations(key, source).length > 0, key)
  }), { seed: 0x16cafe, numRuns: 200 })
})

test("native async defaults and callbacks reject while foreign plain calls throw synchronously", async () => {
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

test("folded grammar retains exact shape and recovery restrictions", () => {
  const current = published()
  assert.deepEqual(violations("whole-shape services", current), [])
  fc.assert(fc.property(fc.constantFrom(
    'ServiceStart TypeParameters? ":" Type',
    "only KeyMember and DefaultMember are admitted",
    "other members parse for EK0902"
  ), fc.nat(20), (clause, padding) => {
    const appendix = current["src/900-appendices.md"]
    assert.ok(appendix.includes(clause), clause)
    const changed = { ...current, "src/900-appendices.md": "Unrelated prose.\n".repeat(padding) + appendix.replace(clause, "[removed]") }
    assert.ok(violations("whole-shape services", changed).length > 0, clause)
  }), { seed: 1104108, numRuns: 180 })
})

test("consistency guards report missing claims instead of bypassing their checks", () => {
  for (const [key, claim] of [
    ["throw expressions", "missing throw-expression claim"],
    ["whole-shape services", "missing whole-shape service claim"],
    ["throw contracts", "missing written-tag diagnostic rule"],
    ["API identity", "missing API identity claim"]
  ]) assert.ok(violations(key, {}).includes(claim), claim)
  assert.ok(violations("throw contracts", { "src/003-failures.md": "Effect 4.1.0" }).includes("src/003-failures.md: stale Effect version"))
})
