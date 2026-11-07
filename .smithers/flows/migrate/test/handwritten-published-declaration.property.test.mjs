import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { compareDeclarations, emitDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-handwritten-published-declaration.json", import.meta.url)))

test("handwritten published declarations quote the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

const scripts = { ".d.ts": ".js", ".d.mts": ".mjs", ".d.cts": ".cjs" }

// One package, recorded before and after a change, as the record gate does:
// same directory, declaration snapshot, public surface, canonical comparison.
async function witness({ layout = "src", extension = ".d.ts", depth = 0, conditions = "import-require", mutation = "same" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "handwritten-published-"))
  const pkg = join(root, "pkg")
  const put = (file, text) => { mkdirSync(dirname(join(pkg, file)), { recursive: true }); writeFileSync(join(pkg, file), text) }
  try {
    const sub = "nested/".repeat(depth), script = scripts[extension]
    // rootDir "." keeps the src segment under the declaration output.
    const out = layout === "package" ? "dist/esm/src/" : "dist/esm/"
    const cjs = layout === "package" ? "dist/cjs/src/" : "dist/cjs/"
    const published = (esm, commonjs, name, declaration, javascript) => conditions === "default-only" ? `./${esm}${name}${javascript}`
      : conditions === "types-default" ? { types: `./${esm}${name}${declaration}`, default: `./${esm}${name}${javascript}` }
      : { import: { types: `./${esm}${name}${declaration}`, default: `./${esm}${name}${javascript}` },
          require: { types: `./${commonjs}${name}${declaration}`, default: `./${commonjs}${name}${javascript}` } }
    put("package.json", JSON.stringify({
      name: "handwritten-published-fixture", type: "module",
      exports: { [`./${corpus.name}`]: `./src/${sub}${corpus.name}${script}`, "./Cli": "./src/Cli.ts" },
      publishConfig: { exports: {
        [`./${corpus.name}`]: published(out + sub, cjs + sub, corpus.name, extension, script),
        "./Cli": published(out, cjs, "Cli", ".d.ts", ".js"),
      } },
    }))
    const options = { outDir: "dist/esm", declaration: true, module: "nodenext", moduleResolution: "nodenext",
      strict: true, skipLibCheck: true, types: [], rootDir: layout === "package" ? "." : "src" }
    put("tsconfig.json", JSON.stringify({ compilerOptions: options, include: ["src"] }))
    put(`src/${sub}${corpus.name}${script}`, corpus.javascript)
    put(`src/${sub}${corpus.name}${extension}`, corpus.declaration)
    put("src/Cli.ts", corpus.module)
    const snapshots = {}
    for (const side of ["before", "after"]) {
      if (side === "after" && mutation === "convert") {
        rmSync(join(pkg, "src/Cli.ts"))
        put("src/Cli.vibe", corpus.module)
      }
      if (side === "after" && mutation === "changed") put(`src/${sub}${corpus.name}${extension}`, corpus.changed)
      const snapshot = join(root, side)
      const emitted = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: pkg, outDir: snapshot, root: pkg })
      assert.equal(emitted.code, 0, JSON.stringify(emitted.diagnostics))
      recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
      snapshots[side] = snapshot
    }
    const result = compareDeclarations(ts, snapshots.before, snapshots.after, { canonical: true })
    const blocking = (result.environmentDiagnostics ?? []).filter(d => d.blocking)
    assert.deepEqual(blocking, [], "an unchanged handwritten entry point must be comparable")
    assert.equal(result.comparisonComplete, true, JSON.stringify(result.environmentDiagnostics))
    // Changing the shipped declaration must still show through its alias.
    assert.equal(result.identical, mutation !== "changed", JSON.stringify(result.typeDifferences ?? result.changed))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Smithers handwritten published declaration compares across a conversion", () =>
  witness({ conditions: "import-require", mutation: "convert" }))

test("an unchanged handwritten published declaration compares identical", () => witness())

test("a changed handwritten published declaration is a difference", () => witness({ mutation: "changed" }))

test("an emitted declaration keeps its path and an ambient declaration gains no entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "handwritten-published-controls-"))
  const pkg = join(root, "pkg")
  const put = (file, text) => { mkdirSync(dirname(join(pkg, file)), { recursive: true }); writeFileSync(join(pkg, file), text) }
  try {
    put("package.json", JSON.stringify({ name: "controls", type: "module", exports: { "./x": "./src/x.ts" } }))
    put("tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist/esm", declaration: true,
      module: "nodenext", moduleResolution: "nodenext", strict: true, skipLibCheck: true, types: [] }, include: ["src"] }))
    put("src/x.ts", corpus.module)
    put("src/env.d.ts", "declare const BUILD_ID: string\n")
    const snapshot = join(root, "snapshot")
    const emitted = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: pkg, outDir: snapshot, root: pkg })
    assert.equal(emitted.code, 0, JSON.stringify(emitted.diagnostics))
    const { aliases } = recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }]).apiMetadata
    assert.equal(aliases["dist/esm/x.d.ts"], "x.d.ts")
    assert.equal(aliases["src/env.d.ts"], ".migrate-shipped/src/env.d.ts")
    assert.equal(aliases["dist/esm/env.d.ts"], undefined)
    assert.equal(aliases["dist/esm/env.js"], undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("handwritten published declarations compare by root, extension, depth and conditions", () => checkProperty(fc, {
  name: "handwritten-published-declaration",
  rule: "a handwritten module declaration the package publishes where its project writes declarations compares like an emitted one",
  command: "node --test .smithers/flows/migrate/test/handwritten-published-declaration.property.test.mjs",
  numRuns: 12,
  arbitrary: fc.record({
    layout: fc.constantFrom("src", "package"),
    extension: fc.constantFrom(".d.ts", ".d.mts", ".d.cts"),
    depth: fc.integer({ min: 0, max: 2 }),
    conditions: fc.constantFrom("import-require", "types-default", "default-only"),
    mutation: fc.constantFrom("same", "convert", "changed"),
  }),
  check: witness,
}))
