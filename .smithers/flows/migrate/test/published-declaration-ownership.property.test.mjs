import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/published-handwritten-copy.json", import.meta.url)))
const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]

test("published declaration ownership quotes the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

async function witness({ output = "types", extension = ".d.ts", order = 0, changed = true, explicit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "published-declaration-owner-"))
  const pkg = join(root, "pkg")
  const put = (base, file, text) => { mkdirSync(dirname(join(base, file)), { recursive: true }); writeFileSync(join(base, file), text) }
  const source = "src/x" + extension, published = output + "/x" + extension
  const script = { ".d.ts": ".js", ".d.mts": ".mjs", ".d.cts": ".cjs" }[extension]
  try {
    put(pkg, "package.json", JSON.stringify({ name: "published-copy", type: "module",
      publishConfig: { exports: { ".": { types: "./" + published, default: "./" + output + "/x" + script } } } }))
    const config = { compilerOptions: { rootDir: "src", outDir: output, declaration: true, types: [],
      module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true }, include: ["src"] }
    put(pkg, "tsconfig.json", JSON.stringify(config))
    put(pkg, "src/Cli.ts", 'export const name: string = "cli"\n')
    put(pkg, "src/x" + script, corpus.javascript)
    put(pkg, source, corpus.before)
    put(pkg, "src/env.d.ts", "declare const BUILD_ID: string\n")
    const snapshots = {}
    for (const side of ["before", "after"]) {
      if (explicit) put(pkg, published, side === "after" && changed ? corpus.after : corpus.before)
      const snapshot = join(root, side)
      // Only Cli.ts emits; the handwritten declarations are copied inputs.
      // Use stock declaration emit without rebuilding its standard libraries.
      const emitted = ts.transpileDeclaration(readFileSync(join(pkg, "src/Cli.ts"), "utf8"), { fileName: "Cli.ts" })
      assert.deepEqual(emitted.diagnostics, [])
      put(snapshot, "Cli.d.ts", emitted.outputText)
      const files = [source, published, "src/env.d.ts"].filter(file => file !== published || explicit)
      const entries = files.map(file => [file, readFileSync(join(pkg, file))])
      const handwritten = new Map(orders[order].filter(i => i < entries.length).map(i => entries[i]))
      const { aliases } = recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }],
        undefined, { handwritten }).apiMetadata
      assert.equal(aliases[published], ".migrate-shipped/" + (explicit ? published : source),
        "an inferred copy must not replace an explicit declaration")
      snapshots[side] = snapshot
    }
    const result = compareDeclarations(ts, snapshots.before, snapshots.after, { canonical: true })
    assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
    assert.deepEqual((result.environmentDiagnostics ?? []).filter(d => d.blocking), [])
    assert.equal(result.identical, !(changed && explicit), JSON.stringify(result.typeDifferences))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("published declarations retain their owner before and after the source directory", async () => {
  for (const output of ["lib", "types"])
    for (let order = 0; order < orders.length; order++) await witness({ output, order })
})

test("a missing published copy retains the inferred handwritten owner", () => witness({ explicit: false }))
test("identical explicit published copies remain comparable", () => witness({ changed: false }))

test("published declaration ownership is independent of extension, path and map order", () => checkProperty(fc, {
  name: "published-declaration-ownership",
  rule: corpus.quote,
  command: "node --test .smithers/flows/migrate/test/published-declaration-ownership.property.test.mjs",
  numRuns: 24,
  arbitrary: fc.record({ output: fc.constantFrom("lib", "types", "build/nested"), extension: fc.constantFrom(".d.ts", ".d.mts", ".d.cts"),
    order: fc.integer({ min: 0, max: orders.length - 1 }), changed: fc.boolean(), explicit: fc.boolean() }),
  check: witness,
}))
