import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"
import { publishedEntrypoints } from "../lib/api-identity.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-canonical-returned-record.json", import.meta.url)))
test("native source condition oracles quote the declaration identity contract", () => {
  const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")
  for (const quote of ["the same doc comment on each export", "each export's type identical to `tsc`'s in both directions"])
    assert.ok(chapter.includes(quote), quote)
})
function witness({ extension = ".ts", depth = 0, defaultFirst = false, mutation = "same", exportJson = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-source-conditions-"))
  const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    const source = "src/" + "nested/".repeat(depth) + "Record" + extension
    const stored = "Record" + (extension === ".mts" ? ".d.mts" : extension === ".cts" ? ".d.cts" : ".d.ts")
    const runtime = "./.vibelang/js/" + source.replace(/\.[^.]+$/, ".js")
    const targets = Object.fromEntries(Object.entries(corpus.after).map(([condition, target]) =>
      [condition, condition === "default" ? runtime : target.replace(corpus.before, "./" + source)]))
    const conditions = defaultFirst
      ? { default: targets.default, ...Object.fromEntries(Object.entries(targets).filter(([key]) => key !== "default")) }
      : targets
    const manifest = target => ({ name: "native-source-conditions", type: "module", exports: { "./Record": target, ...(exportJson ? { "./package.json": "./package.json" } : {}) } })
    const stock = join(root, "stock")
    put(join(stock, "package.json"), JSON.stringify(manifest(conditions)))
    put(join(stock, source), corpus.source)
    const selected = publishedEntrypoints(stock, ts)
    assert.ok(selected["./Record"])
    assert.equal(selected["./Record"], join(stock, source))
    const program = ts.createProgram([selected["./Record"]], { noEmit: true, strict: true, types: [], jsx: ts.JsxEmit.Preserve })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], "the original native source is valid TypeScript")
    for (const [side, target] of [["before", "./" + source], ["after", conditions]]) {
      const dir = join(root, side), pkg = manifest(target)
      let declaration = corpus.declaration
      if (side === "after" && mutation === "type") declaration = declaration.replace("Record<string, unknown>", "Record<string, number>")
      if (side === "after" && mutation === "docs") declaration = declaration.replace("Checks the container", "Inspects the container")
      put(join(dir, stored), declaration)
      put(join(dir, "public-surface.json"), JSON.stringify({
        snapshotVersion: 3, roots: [stored], reachable: [stored], unresolved: [],
        apiMetadata: { manifest: pkg, packageDir: stock,
          aliases: side === "after" && mutation === "missing" ? {} : { [source]: stored },
          logicalPaths: { [stored]: "dist/esm/" + stored } },
      }))
    }
    const result = compareDeclarations(ts, join(root, "before"), join(root, "after"))
    assert.equal(result.comparisonComplete, mutation !== "missing", JSON.stringify(result))
    assert.equal(result.identical, mutation === "same" && !exportJson, JSON.stringify(result))
    if (exportJson && mutation !== "missing") assert.ok(result.typeDifferences.some(item => item.entrypoint === "./package.json"), JSON.stringify(result))
    if (mutation === "type") assert.ok(result.typeDifferences.length, JSON.stringify(result))
    if (mutation === "docs") assert.ok(result.docDifferences.length, JSON.stringify(result))
    if (mutation === "missing") assert.ok(result.environmentDiagnostics.length, JSON.stringify(result))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("canonical returned Record keeps its native source types condition in a declaration snapshot", witness)
test("source target projection retains the exported package JSON shape difference", () => witness({ exportJson: true }))
for (const mutation of ["type", "docs", "missing"])
  test("native source snapshots reject " + mutation + " changes", () => witness({ mutation }))
test("property: native source condition snapshots preserve types, docs and recorded provenance", async () => {
  await checkProperty(fc, {
    name: corpus.key,
    rule: "001 API identity: recorded native source entrypoints keep identical exported types and documentation; missing source provenance remains unavailable.",
    command: "node --test .smithers/flows/migrate/test/native-source-snapshot-conditions.property.test.mjs",
    generatorVersion: 1, numRuns: 32,
    arbitrary: fc.record({ extension: fc.constantFrom(".ts", ".tsx", ".mts", ".cts"), depth: fc.integer({ min: 0, max: 2 }), defaultFirst: fc.boolean(), mutation: fc.constantFrom("same", "type", "docs", "missing") }),
    check: witness,
  })
})
