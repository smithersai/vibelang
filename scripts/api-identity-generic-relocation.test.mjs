import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"
import { checkProperty } from "./testing/property.mjs"

const es5 = createEs5FixtureGuard(loadTypeScript(), "Relocated generic declarations")
const ts = es5.ts
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-generic-payload-relocation.json", import.meta.url)))
assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule))
const options = { lib: ["lib.es5.d.ts"], types: [], strict: true }
const differences = result => result.typeDifferences.map(d => [d.export, d.aspect])

function fixture({ path = "native", local = "PayloadOf", style = "named", nested = false, change = text => text } = {}, check) {
  const root = mkdtempSync(join(tmpdir(), "api-generic-relocation-"))
  try {
    const before = join(root, "before"), after = join(root, "after")
    const put = (dir, file, text) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), text)
    }
    const entry = nested ? "entry.d.ts" : "index.d.ts"
    if (nested) for (const dir of [before, after]) put(dir, "index.d.ts", 'export * as API from "./entry.js";\n')
    put(before, entry, corpus.declarations)
    let declarations = change(corpus.declarations).replaceAll("PayloadOf", local)
    if (local !== "PayloadOf") declarations += `export { ${local} as PayloadOf };\n`
    put(after, path + ".d.ts", declarations)
    const forwarded = style === "star" && local === "PayloadOf" ? "*" : "{ Box, PayloadOf, make }"
    put(after, entry, `export ${forwarded} from "./${path}.js";\n`)
    const entries = { "index.d.ts": "index.d.ts" }
    const compare = () => compareApiIdentity(ts, before, after, {
      beforeEntrypoints: entries, afterEntrypoints: entries, compilerOptions: options,
    })
    return check({ before, after, compare })
  } finally { es5.assertLibraries(); rmSync(root, { recursive: true, force: true }) }
}
function verify(shape) {
  fixture(shape, ({ compare }) => {
    const result = compare()
    assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.identical, true, JSON.stringify(differences(result)))
  })
}

test("a relocated inferred payload alias and generic constructor preserve strict identity", () => verify())
test("a renamed private alias corresponds through its public export", () => verify({ local: "PrivatePayload", path: "internal/throwing" }))
test("namespace views retain relocated generic identities", () => verify({ nested: true }))
test("stock TypeScript preserves a relocated generic constructor's consumer constraints", () => {
  fixture({}, ({ before, after }) => {
    for (const dir of [before, after]) {
      const file = join(dir, "consumer.ts")
      writeFileSync(file, 'import { make } from "./index.js";\nconst valid: number = make({ value: 1 });\nconst invalid: string = make({ value: 1 });\n')
      const program = ts.createProgram([file], { ...options, noEmit: true })
      const errors = ts.getPreEmitDiagnostics(program)
      assert.deepEqual(errors.map(d => d.code), [2322])
      assert.equal(ts.flattenDiagnosticMessageText(errors[0].messageText, "\n"), "Type 'number' is not assignable to type 'string'.")
    }
  })
})

for (const [name, change] of [
  ["true branch", text => text.replace("? A :", "? A[] :")],
  ["false branch", text => text.replace(": never;", ": string;")],
  ["inference position", text => text.replace("Box<infer A>", "Box<Box<infer A>>")],
  ["inference constraint", text => text.replace("infer A", "infer A extends string")],
  ["parameter constraint", text => text.replace("PayloadOf<R>", "PayloadOf<R extends object>").replace("make<T>", "make<T extends object>")],
  ["constructor result", text => text.replace("value: T): PayloadOf<T>", "value: T): PayloadOf<T>[]")],
  ["payload documentation", text => text.replace("The extracted payload.", "Changed payload documentation.")],
]) test("relocation still rejects a changed " + name, () => {
  fixture({ change }, ({ compare }) => {
    const result = compare()
    assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.identical, false)
    assert.ok(result.typeDifferences.length || result.docDifferences.length)
  })
})

test("a missing relocation target remains unavailable", () => {
  fixture({}, ({ after, compare }) => {
    rmSync(join(after, "native.d.ts"))
    const result = compare()
    assert.equal(result.comparisonComplete, false)
    assert.equal(result.identical, false)
  })
})

test("property: relocation follows public aliases and retains changed inferred results", async () => {
  await checkProperty(fc, {
    name: "api-identity-generic-payload-relocation", rule: corpus.rule,
    command: "node --test scripts/api-identity-generic-relocation.test.mjs",
    arbitrary: fc.record({
      path: fc.constantFrom("native", "internal/throwing", "deep/private/payload"),
      local: fc.constantFrom("PayloadOf", "PrivatePayload"),
      style: fc.constantFrom("named", "star"), nested: fc.boolean(),
    }),
    numRuns: 16,
    check: shape => {
      verify(shape)
      fixture({ ...shape, change: text => text.replace("? A :", "? A[] :") }, ({ compare }) => {
        const result = compare()
        assert.equal(result.comparisonComplete, true)
        assert.equal(result.identical, false)
        assert.ok(result.typeDifferences.some(d => d.export.endsWith("PayloadOf")))
      })
    },
  })
})
