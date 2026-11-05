import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { createRequire } from "node:module"
import { compareApiIdentity } from "../../scripts/api-identity.mjs"

const ts = createRequire(import.meta.url)("typescript")
const source = "export function add(a: number, b: number): number { return a + b }"
const signature = "export declare function add(a: number, b: number): number;"
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "cov4-contract-"))
  try {
    for (const [name, text] of Object.entries({ before, after })) {
      mkdirSync(join(root, name))
      writeFileSync(join(root, name, "index.d.ts"), text)
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function allowNever() {
  const plain = "/** Add two numbers. */\n" + signature
  const generated = "/** Add two numbers.\n * @throws {never}\n */\n" + signature
  assert.doesNotMatch(plain, /@throws/)
  const result = compare(plain, generated)
  assert.equal(result.identical, true, JSON.stringify(result))
}
function stockTwin() {
  const result = ts.transpileDeclaration(source, {
    fileName: "twin.ts", compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }, reportDiagnostics: true
  })
  assert.deepEqual(result.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [])
  assert.doesNotMatch(result.outputText, /@throws/)
  assert.equal(compare(result.outputText, "/** @throws {never} */\n" + result.outputText).identical, true)
}
function rejectDocs() {
  const authored = "/** Add.\n * @throws {Error}\n */\n" + signature
  assert.equal(compare(authored, authored).identical, true)
  for (const changed of [
    authored.replace("{Error}", "{TypeError}"),
    authored.replace(" * @throws {Error}\n", ""),
    authored.replace("Add.", "Changed."),
  ]) {
    const result = compare(authored, changed)
    assert.equal(result.identical, false, changed)
    assert.ok(result.docDifferences.length, JSON.stringify(result))
  }
  const plain = "/** Add. */\n" + signature
  for (const tag of ["@throws {never} explanation", "@deprecated old", "@throws {never}\n * @since 1.0"]) {
    const result = compare(plain, "/** Add.\n * " + tag + "\n */\n" + signature)
    assert.equal(result.identical, false, tag)
    assert.ok(result.docDifferences.length, JSON.stringify(result))
  }
}

// Pending declarations retain individual obligations whose compiler, runtime,
// fix sequencing or cross-package matrix is deferred. They do not assert a mismatch.

test("Chapter 001: Preserve every authored throw tag and reject other JSDoc differences [docs/design/src/001-functions.md#24cafeb41b813b5e]", () => {
  // rule-evidence: docs/design/src/001-functions.md#24cafeb41b813b5e — Chapter 001: Preserve every authored throw tag and reject other JSDoc differences.
  rejectDocs()
})

// rule-evidence: docs/design/src/001-functions.md#b12e0b1204c985cd — Chapter 001: Reject generated output tags authored in VibeLang with EK0406.
test.todo("Chapter 001: Reject generated output tags authored in VibeLang with EK0406 [docs/design/src/001-functions.md#b12e0b1204c985cd]")

// rule-evidence: docs/design/src/002-running.md#953bdcc875340d8b — Chapter 002: Only direct try consumption exempts generic composition, including callbacks.
test.todo("Chapter 002: Only direct try consumption exempts generic composition, including callbacks [docs/design/src/002-running.md#953bdcc875340d8b]")

// rule-evidence: docs/design/src/007-tooling.md#9840ae842f687026 — Chapter 007: Effect-valued callbacks stay cold and try runs only the selected arm.
test.todo("Chapter 007: Effect-valued callbacks stay cold and try runs only the selected arm [docs/design/src/007-tooling.md#9840ae842f687026]")

// rule-evidence: docs/design/src/007-tooling.md#67a0cb27252a577e — Chapter 007: Each off-pin platform peer reports once with resolved and pinned versions.
test.todo("Chapter 007: Each off-pin platform peer reports once with resolved and pinned versions [docs/design/src/007-tooling.md#67a0cb27252a577e]")

// rule-evidence: docs/design/src/900-appendices.md#334bea82e6eb1870 — Chapter 900: Existing operator-left throw expression violations remain errors.
test.todo("Chapter 900: Existing operator-left throw expression violations remain errors [docs/design/src/900-appendices.md#334bea82e6eb1870]")

// rule-evidence: docs/design/src/900-appendices.md#a21c1c94f9cffe92 — Chapter 900: EK4802 is advisory and off-configurable for inferred generic Effect arguments.
test.todo("Chapter 900: EK4802 is advisory and off-configurable for inferred generic Effect arguments [docs/design/src/900-appendices.md#a21c1c94f9cffe92]")

// rule-evidence: docs/design/vips/0001-effect-and-async-functions.md#953bdcc875340d8b — VIP-1: Only direct try consumption exempts generic composition, including callbacks.
test.todo("VIP-1: Only direct try consumption exempts generic composition, including callbacks [docs/design/vips/0001-effect-and-async-functions.md#953bdcc875340d8b]")

test("VIP-27: Generated never is the one permitted declaration JSDoc exception [docs/design/vips/0027-declaration-output.md#5ba5eadf9b560915]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#5ba5eadf9b560915 — VIP-27: Generated never is the one permitted declaration JSDoc exception.
  allowNever()
})

test("VIP-27: Compare an ordinary stock TypeScript twin without manufacturing generated tags [docs/design/vips/0027-declaration-output.md#7ea254b370f2ac72]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#7ea254b370f2ac72 — VIP-27: Compare an ordinary stock TypeScript twin without manufacturing generated tags.
  stockTwin()
})

test("VIP-27: Permit exactly generated throws never when no throw contract was authored [docs/design/vips/0027-declaration-output.md#dd35af72a239fc2e]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#dd35af72a239fc2e — VIP-27: Permit exactly generated throws never when no throw contract was authored.
  allowNever()
})

test("VIP-27: Reject changed or removed authored throws, described generated tags and extra tags [docs/design/vips/0027-declaration-output.md#e1d7ccd16bba7283]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#e1d7ccd16bba7283 — VIP-27: Reject changed or removed authored throws, described generated tags and extra tags.
  rejectDocs()
})

// rule-evidence: docs/design/vips/0027-declaration-output.md#8ec25f0529d51083 — VIP-27: Async declarations retain never spelling while calls return rejecting Promises.
test.todo("VIP-27: Async declarations retain never spelling while calls return rejecting Promises [docs/design/vips/0027-declaration-output.md#8ec25f0529d51083]")

// rule-evidence: docs/design/vips/0027-declaration-output.md#1366df2593b6163e — VIP-27: Preserve authored throws and rethrows without replacement or duplication.
test.todo("VIP-27: Preserve authored throws and rethrows without replacement or duplication [docs/design/vips/0027-declaration-output.md#1366df2593b6163e]")

test("VIP-27: The unannotated add twin matches the emitted generated never declaration [docs/design/vips/0027-declaration-output.md#2ab653ed5d3d179e]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#2ab653ed5d3d179e — VIP-27: The unannotated add twin matches the emitted generated never declaration.
  stockTwin()
})

// rule-evidence: docs/design/vips/0027-declaration-output.md#05b5f0baa9dc0d48 — VIP-27: Generated throw contracts remain output-only and source tags report EK0406.
test.todo("VIP-27: Generated throw contracts remain output-only and source tags report EK0406 [docs/design/vips/0027-declaration-output.md#05b5f0baa9dc0d48]")

test("VIP-27: Retain the generated never exception after the published matcher amendment [docs/design/vips/0027-declaration-output.md#48ddfeae4bfe1d48]", () => {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#48ddfeae4bfe1d48 — VIP-27: Retain the generated never exception after the published matcher amendment.
  allowNever()
})

// rule-evidence: docs/design/vips/0027-declaration-output.md#1114cddd3de867a6 — VIP-27: Published error constructor typing and own matcher dispatch work across copies.
test.todo("VIP-27: Published error constructor typing and own matcher dispatch work across copies [docs/design/vips/0027-declaration-output.md#1114cddd3de867a6]")

// rule-evidence: docs/design/src/002-running.md#a504880b23f48fb9 — Chapter 002: Annotated Effect arguments still warn in bare generic or plain container positions.
// Activation: confirm typescript/tsc/internal/vibelang/effect_generic_argument_test.go:TestEffectIntoPlainGeneric; cfbox Go dependency resolution currently prevents execution.
test.todo("Chapter 002: Annotated Effect arguments still warn in bare generic or plain container positions [docs/design/src/002-running.md#a504880b23f48fb9]")

// rule-evidence: docs/design/src/005-services.md#a67dc13dcc9ae35f — Chapter 005: Service members preserve written readonly and native writable defaults.
// Activation: confirm typescript/tsc/internal/vibelang/service_readonly_migration_test.go:TestServiceReadonlyMigrationModes; cfbox Go dependency resolution currently prevents execution.
test.todo("Chapter 005: Service members preserve written readonly and native writable defaults [docs/design/src/005-services.md#a67dc13dcc9ae35f]")

// rule-evidence: docs/design/src/005-services.md#e3b20b93374e010d — Chapter 005: Service conversion and fix printing preserve optional and nested readonly modifiers.
// Activation: confirm typescript/tsc/internal/vibelang/service_readonly_conversion_test.go:TestServiceReadonlyConversion; cfbox Go dependency resolution currently prevents execution.
test.todo("Chapter 005: Service conversion and fix printing preserve optional and nested readonly modifiers [docs/design/src/005-services.md#e3b20b93374e010d]")

// rule-evidence: docs/design/vips/0001-effect-and-async-functions.md#a504880b23f48fb9 — VIP-1: Annotated Effect arguments still warn in bare generic or plain container positions.
// Activation: confirm typescript/tsc/internal/vibelang/effect_generic_argument_test.go:TestEffectIntoPlainGeneric; cfbox Go dependency resolution currently prevents execution.
test.todo("VIP-1: Annotated Effect arguments still warn in bare generic or plain container positions [docs/design/vips/0001-effect-and-async-functions.md#a504880b23f48fb9]")
