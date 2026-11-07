import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/t3code-schema-mapped-self-copy.json", import.meta.url)))
assert.ok(readFileSync(new URL("../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(corpus.rule),
  "the API identity rule must remain quoted from the specification")

const compilerOptions = {
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true,
  exactOptionalPropertyTypes: true, skipLibCheck: false,
  moduleSuffixes: ["", ".d.vibe"], types: [],
}

function fixture({ count = 17, alias = "Schema", nested = true, extension = ".js" } = {}, run) {
  const root = mkdtempSync(join(tmpdir(), "api-schema-mapped-"))
  try {
    symlinkSync(resolve("docs/tools/node_modules"), join(root, "node_modules"), "dir")
    const before = join(root, "before"), after = join(root, "after")
    for (const dir of [before, after]) {
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), JSON.stringify({ types: "entry.d.ts" }))
      writeFileSync(join(dir, "entry.d.ts"), dir === after ? corpus.entry.replace("../dep.js", "../dep" + extension) : corpus.entry)
    }
    const fields = Array.from({ length: count - (nested ? 2 : 1) }, (_, i) =>
      `readonly ${corpus.fields[i] ?? "field" + i}: ${alias}.optional<${alias}.Int>`)
    fields.unshift(`readonly required: ${alias}.Int`)
    if (nested) fields.push(`readonly cost: ${alias}.optional<${alias}.Struct<{ readonly amount: ${alias}.Number; readonly currency: ${alias}.decodeTo<${alias}.String, ${alias}.String, never, never> }>>`)
    writeFileSync(join(root, "dep.d.ts"), `import * as ${alias} from "effect/Schema"; export declare const Snapshot: ${alias}.Struct<{${fields.join(";")}}>; export type Snapshot = typeof Snapshot.Type;`)
    const validate = dir => {
      const program = ts.createProgram([join(dir, "entry.d.ts")], { ...compilerOptions, noEmit: true })
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [],
        "the authored declaration must be valid before comparison")
    }
    validate(before)
    const compare = () => compareApiIdentity(ts, before, after, {
      compilerOptions, moduleRoots: [join(root, "node_modules")],
    })
    return run({ after, compare, validate })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function verify(shape) {
  fixture(shape, ({ after, compare, validate }) => {
    let result = compare()
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, true, JSON.stringify(result))
    writeFileSync(join(after, "entry.d.ts"), corpus.entry.replace(/;$/, " & { readonly added: string };"))
    validate(after)
    result = compare()
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.typeDifferences.some(d => d.export === "Nullable"), JSON.stringify(result))
  })
}

test("copied schema mapped declarations keep reified keyof names in scope", () => verify())

test("unresolved authored schema names keep comparison unavailable", () => {
  fixture({}, ({ after, compare }) => {
    writeFileSync(join(after, "entry.d.ts"), corpus.entry.replace("keyof Snapshot", "keyof Missing"))
    const result = compare()
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(d => d.blocking && /TS2304/.test(d.diagnostic)), JSON.stringify(result))
  })
})

test("property: copied schema mapped APIs preserve identity and expose real changes", async () => {
  await checkProperty(fc, {
    name: "api-identity-schema-mapped-self-copy", generatorVersion: 1,
    rule: corpus.rule,
    command: "node --test scripts/api-identity-schema-mapped.test.mjs",
    arbitrary: fc.record({
      count: fc.integer({ min: 16, max: 64 }),
      alias: fc.constantFrom("Schema", "Codec", "S"), nested: fc.boolean(),
      extension: fc.constantFrom(".js", ""),
    }),
    numRuns: 12, check: verify,
  })
})
