import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const options = { compilerOptions: { lib: ["lib.es5.d.ts"], types: [] } }
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/alchemy-unique-symbol-relocation.json", import.meta.url)))
const show = value => JSON.stringify(value, null, 2)

function fixture(files, check) {
  const root = mkdtempSync(join(tmpdir(), "api-symbol-relocation-"))
  try {
    const dirs = ["before", "after"].map(side => join(root, side))
    for (const [side, dir] of dirs.entries()) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "package.json"), '{"types":"index.d.ts"}')
      for (const [file, text] of Object.entries(files[side])) {
        mkdirSync(dirname(join(dir, file)), { recursive: true })
        writeFileSync(join(dir, file), text)
      }
    }
    return check(...dirs)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (before, after) => fixture([before, after], (a, b) => compareApiIdentity(ts, a, b, options))

function consumers(dir) {
  const source = 'import { InputMeta, Other, type Value } from "./index.js";'
  writeFileSync(join(dir, "consumer.ts"), source + `
const good: Value = { [InputMeta]: "ok" };
// @ts-expect-error A different unique symbol cannot satisfy the metadata key.
const wrongKey: Value = { [Other]: "ok" };
// @ts-expect-error The value at the metadata key must remain a string.
const wrongValue: Value = { [InputMeta]: 42 };
`)
  const program = ts.createProgram([join(dir, "consumer.ts")], {
    strict: true, noEmit: true, types: [], lib: ["lib.es5.d.ts"], target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
}
function verify({ path = "internal/input", alias = "rawKey", style = "named" } = {}) {
  const before = { ...corpus.before }
  const raw = corpus.after["internal/input.d.ts"].replaceAll("rawKey", alias)
  const forward = style === "star" && alias === "InputMeta" ? `export * from "./${path}.js";\n`
    : `export { ${alias} as InputMeta, Other, type Value } from "./${path}.js";\n`
  const after = { "index.d.ts": forward, [path + ".d.ts"]: raw }
  fixture([before, after], (a, b) => {
    // Stock tsc accepts the positive consumer and rejects both negative controls.
    consumers(a); consumers(b)
    const result = compareApiIdentity(ts, a, b, options)
    assert.equal(result.comparisonComplete, true, show(result))
    assert.equal(result.identical, true, show(result))
  })
  for (const changed of [
    raw.replace(`[${alias}]: string`, `[${alias}]: number`),
    raw.replace(`[${alias}]: string`, "[Other]: string"),
    raw.replace("Metadata key.", "Changed metadata key."),
    raw.replace("Input value.", "Changed input value."),
  ]) {
    const result = compare(before, { ...after, [path + ".d.ts"]: changed })
    assert.equal(result.comparisonComplete, true, show(result))
    assert.equal(result.identical, false, show(result))
    assert.ok(result.typeDifferences.length || result.docDifferences.length, show(result))
  }
}
test("alchemy relocated unique-symbol declaration retains strict identity and consumer constraints", () => verify())
test("unique-symbol aliases retain split and merge differences", () => {
  const shared = { "index.d.ts": "declare const key: unique symbol; export { key as A, key as B };" }
  const split = { "index.d.ts": 'export { A, B } from "./internal.js";', "internal.d.ts": "export declare const A: unique symbol; export declare const B: unique symbol;" }
  for (const [a, b] of [[shared, split], [split, shared]]) {
    const result = compare(a, b)
    assert.equal(result.comparisonComplete, true, show(result))
    assert.equal(result.identical, false, show(result))
    assert.ok(result.typeDifferences.length, show(result))
  }
})
test("property: private relocation preserves public symbol correspondence and detects semantic mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-unique-symbol-relocation",
    rule: "Public declarations reachable from exports or types must remain API-identical; internal file layout can change while retaining the API.",
    command: "node --test scripts/api-identity-symbol-relocation.test.mjs",
    arbitrary: fc.record({
      path: fc.constantFrom("internal/input", "private/metadata", "nested/private/value"),
      alias: fc.constantFrom("rawKey", "InputMeta", "privateMeta"),
      style: fc.constantFrom("named", "star"),
    }),
    numRuns: 16, check: verify,
  })
})
