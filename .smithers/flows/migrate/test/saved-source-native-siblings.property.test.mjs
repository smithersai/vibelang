import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, listDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { apiProjection } from "../lib/api-projection.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-saved-source-native-sibling.json", import.meta.url)))
const manifest = { private: true, type: "module" }
const layout = { category: "error", code: "TS5011", file: "apps/server/tsconfig.json", line: 2, column: 3,
  message: "The common source directory is outside the project; rootDir must be explicit.", notes: [] }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("saved native siblings quote the API identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})

function fixture(check, { extension = "vibe", depth = 0, relocated = false, missing = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "saved-native-sibling-"))
  const folder = "scripts/lib/" + "nested/".repeat(depth)
  const source = folder + "model." + extension
  const sidecar = (relocated ? "decl/" : "") + folder + "model.d." + extension + ".ts"
  const helper = folder + "helper.ts"
  const config = 'export { allowed } from "../../' + helper + '";\n'
  const helperText = 'import type { Box } from "./model.' + extension + '";\nexport const allowed = (): Box<number> => ({ value: 1 });\n'
  try {
    put(join(root, "apps/server/package.json"), JSON.stringify(manifest))
    put(join(root, "scripts/package.json"), JSON.stringify(manifest))
    put(join(root, source), corpus.native)
    put(join(root, helper), helperText)
    put(join(root, "apps/server/vite.config.ts"), config)
    put(join(root, "apps/server/tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        types: [], skipLibCheck: true, allowImportingTsExtensions: true, allowArbitraryExtensions: true,
        rewriteRelativeImportExtensions: true, ...(relocated ? { rootDirs: ["../..", "../../decl"] } : {}) },
      vibe: { effectModules: false, ...(relocated ? { sidecarDir: "../../decl" } : {}) },
      include: ["vite.config.ts", "../../scripts/lib"]
    }))
    const snapshot = (name, { declaration = corpus.declaration, diagnostics = [layout] } = {}) => {
      if (!missing) put(join(root, sidecar), declaration)
      const dir = join(root, name)
      put(join(dir, "vite.config.d.ts"), config)
      const surface = recordDeclarationSurface(ts, dir, join(root, "apps/server"),
        [{ tsconfig: "tsconfig.json", prefix: "." }], manifest, { emitDiagnostics: diagnostics, emitRoot: root })
      return { dir, surface }
    }
    return check({ root, source, sidecar, helper, helperText, snapshot })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (a, b) => compareDeclarations(ts, a.dir, b.dir, { canonical: true, includePrivate: true })

test("T3 Code saved sources retain their native sibling declaration", () => fixture(({ snapshot }) => {
  const result = compare(snapshot("before"), snapshot("after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
}))

test("changed native sibling types still fail API identity", () => fixture(({ snapshot }) => {
  const result = compare(snapshot("before"), snapshot("after", { declaration: corpus.declaration.replace("value: T", "value: T | null") }))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "allowed"), JSON.stringify(result.typeDifferences))
}))

test("saved native sibling declarations are frozen before live files change", () => fixture(({ root, sidecar, snapshot }) => {
  const before = snapshot("before"), after = snapshot("after")
  put(join(root, sidecar), "export interface Wrong {}\n")
  const result = compare(before, after)
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, true)
}))

test("missing native sidecars remain unavailable", () => fixture(({ snapshot }) => {
  const result = compare(snapshot("before"), snapshot("after"))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(blockers(result)))
}, { missing: true }))

test("unresolved native sidecar dependencies remain unavailable", () => fixture(({ snapshot }) => {
  const declaration = 'import type { Missing } from "./missing.js";\nexport interface Box<T> { readonly value: Missing<T> }\n'
  const result = compare(snapshot("before", { declaration }), snapshot("after", { declaration }))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(blockers(result)))
}))

test("native siblings with a relocated sidecar retain their original resolution context", () => fixture(({ snapshot }) => {
  const result = compare(snapshot("before"), snapshot("after"))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, true)
}, { extension: "vibex", relocated: true }))


test("refreshing snapshot metadata preserves its frozen native declaration", () => fixture(({ root, sidecar, snapshot }) => {
  const before = snapshot("before"), after = snapshot("after")
  rmSync(join(root, sidecar))
  recordDeclarationSurface(ts, before.dir, join(root, "apps/server"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest)
  const result = compare(before, after)
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, true)
}))

test("a native declaration error cannot use a stale compatibility sidecar", () => fixture(({ snapshot }) => {
  const diagnostics = [{ ...layout, code: "TS4023", file: "scripts/lib/model.vibe", message: "Exported variable cannot be named." }]
  const result = compare(snapshot("before", { diagnostics }), snapshot("after", { diagnostics }))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).length > 0)
}))

test("property: saved native siblings keep the selected sidecar across layouts", async () => {
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/saved-source-native-siblings.property.test.mjs",
    numRuns: 50,
    arbitrary: fc.record({ extension: fc.constantFrom("vibe", "vibex"), depth: fc.integer({ min: 0, max: 3 }),
      relocated: fc.boolean(), missing: fc.boolean() }),
    check: options => fixture(({ root, sidecar, snapshot }) => {
      const saved = snapshot("before")
      const projection = apiProjection(ts, saved.dir, saved.surface, listDeclarations(saved.dir), { published: false })
      try {
        const configFile = join(projection.directory, "__test__.ts")
        const helperFile = join(projection.directory, "../../scripts/lib/", "nested/".repeat(options.depth), "helper.ts")
        const specifier = "./model." + options.extension
        const context = projection.projectContexts.find(c => c.files.includes(helperFile))
        assert.ok(context, configFile)
        const resolved = ts.resolveModuleName(specifier, helperFile, context.compilerOptions, ts.sys).resolvedModule
        if (options.missing) assert.equal(resolved, undefined)
        else {
          assert.ok(resolved, specifier)
          const program = ts.createProgram([resolved.resolvedFileName], { ...context.compilerOptions, noLib: true, types: [] })
          const checker = program.getTypeChecker()
          const module = checker.getSymbolAtLocation(program.getSourceFile(resolved.resolvedFileName))
          let box = checker.getExportsOfModule(module).find(symbol => symbol.name === "Box")
          assert.ok(box, specifier)
          if (box.flags & ts.SymbolFlags.Alias) box = checker.getAliasedSymbol(box)
          const frozen = box.declarations[0].getSourceFile().fileName
          assert.equal(readFileSync(frozen, "utf8"), corpus.declaration)
          put(join(root, sidecar), "export interface Wrong {}\n")
          assert.equal(readFileSync(frozen, "utf8"), corpus.declaration)
        }
      } finally { projection.cleanup() }
    }, options)
  })
})
