import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { apiProjection } from "../lib/api-projection.mjs"
import { publishedEntrypoints } from "../lib/api-identity.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-canonical-returned-record.json", import.meta.url)))
const options = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, types: [] }

test("native source manifest fields quote the declaration identity contract", () => {
  const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")
  for (const quote of ["each export's type identical to `tsc`'s in both directions", "the same doc comment on each export"])
    assert.ok(chapter.includes(quote), quote)
})

function witness({ field = "imports", extension = ".ts", depth = 0, shape = "nested", missing = false, check = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "source-manifest-fields-"))
  const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  let projection
  try {
    const source = "src/" + "nested/".repeat(depth) + "Record" + extension
    const stored = "Record" + (extension === ".mts" ? ".d.mts" : extension === ".cts" ? ".d.cts" : ".d.ts")
    const target = "./" + source
    const conditional = shape === "literal" ? target : shape === "array" ? [target]
      : { types: { import: target, default: target }, default: "./runtime/Record.js" }
    const entry = field === "imports" ? { imports: { "#record": conditional } }
      : field === "exports" ? { exports: { ".": conditional } } : { [field]: target }
    const manifest = { name: "manifest-fixture", type: "module", ...entry,
      custom: { types: target }, description: "An unchanged package description" }
    const stock = join(root, "stock"), snapshot = join(root, "snapshot")
    put(join(stock, "package.json"), JSON.stringify(manifest))
    put(join(stock, source), corpus.source)
    put(join(snapshot, stored), corpus.declaration)
    projection = apiProjection(ts, snapshot, {
      apiMetadata: { manifest, packageDir: stock,
        aliases: missing ? {} : { [source]: stored }, logicalPaths: { [stored]: "dist/" + stored } },
    }, [stored])

    const specifier = field === "imports" ? "#record" : "manifest-fixture"
    const resolve = (directory, label) => {
      const consumer = field === "imports" ? join(directory, "consumer.ts") : join(root, label, "consumer.ts")
      if (field !== "imports") {
        const modules = join(dirname(consumer), "node_modules")
        mkdirSync(modules, { recursive: true })
        symlinkSync(directory, join(modules, "manifest-fixture"), "dir")
      }
      put(consumer, `import { isRecord } from ${JSON.stringify(specifier)};
const guard: (value: unknown) => value is Record<string, unknown> = isRecord;
`)
      const selected = ts.resolveModuleName(specifier, consumer, options, ts.sys).resolvedModule
      return { consumer, selected }
    }
    const original = resolve(stock, "before"), actual = resolve(projection.directory, "after")
    assert.equal(original.selected?.resolvedFileName, join(stock, source), "stock TypeScript selects the recorded source entry")
    if (missing) assert.equal(actual.selected, undefined, "absent recorded provenance must not fabricate a declaration entry")
    else {
      assert.ok(actual.selected, "the declaration snapshot must resolve the same package entry")
      assert.match(actual.selected.resolvedFileName, /\.d\.(?:[cm]?ts)$/)
    }
    if (check) {
      for (const input of [original, actual]) {
        const program = ts.createProgram([input.consumer], options)
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "stock source and reconstructed declarations retain the public type")
      }
    }
    if (!missing && field !== "imports") {
      const entries = publishedEntrypoints(projection.directory, ts)
      assert.ok(Object.keys(entries).length, "the root remains a published declaration entry")
      for (const entry of Object.values(entries))
        assert.doesNotThrow(() => readFileSync(entry), "API verification must read each selected declaration")
    }
    const written = JSON.parse(readFileSync(join(projection.directory, "package.json"), "utf8"))
    assert.deepEqual(written.custom, manifest.custom, "unrelated fields retain their original source spelling")
    assert.equal(written.description, manifest.description)
    assert.deepEqual(Object.keys(written), Object.keys(manifest), "manifest field order is retained")
    if (shape === "nested" && (field === "imports" || field === "exports")) {
      const selected = field === "imports" ? written.imports["#record"] : written.exports["."]
      assert.deepEqual(Object.keys(selected), ["types", "default"])
      assert.deepEqual(Object.keys(selected.types), ["import", "default"])
    }
  } finally { projection?.cleanup(); rmSync(root, { recursive: true, force: true }) }
}

for (const field of ["exports", "imports", "types", "typings"])
  test("native source " + field + " resolves through its stored declaration", () => witness({ field, check: true }))
test("unrecorded source import targets remain unavailable", () => witness({ missing: true }))
test("property: source manifest entry forms retain stock TypeScript resolution", async () => {
  const paths = { missing: fc.boolean(), extension: fc.constantFrom(".ts", ".tsx", ".mts", ".cts"), depth: fc.integer({ min: 0, max: 2 }) }
  await checkProperty(fc, {
    name: corpus.key + "-manifest-fields",
    rule: "001 API identity: reconstructing a recorded source entry preserves its exported type; missing provenance remains unavailable.",
    command: "node --test .smithers/flows/migrate/test/native-source-manifest-fields.property.test.mjs",
    numRuns: 32, generatorVersion: 1,
    arbitrary: fc.oneof(
      fc.record({ ...paths, field: fc.constantFrom("types", "typings"), shape: fc.constant("literal") }),
      fc.record({ ...paths, field: fc.constantFrom("exports", "imports"), shape: fc.constantFrom("literal", "nested", "array") }),
    ),
    check: witness,
  })
})
