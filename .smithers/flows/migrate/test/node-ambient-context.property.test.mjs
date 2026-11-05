import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations } from "../lib/declarations.mjs"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const runtimeRequire = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const nodeTypes = dirname(runtimeRequire.resolve("@types/node/package.json"))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-node-ambient-context.json", import.meta.url)))
const layouts = ["explicit", "automatic", "typeRoots", "extends"]

test("project ambient types quote the declaration identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8")
    .includes("each export's type identical to `tsc`'s in both directions"))
})

function fixture({ layout = "explicit", depth = 0, shape = "alias", changed = false, types } = {}, check) {
  const root = mkdtempSync(join(tmpdir(), "project-ambient-context-"))
  const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  const inputFiles = []
  try {
    for (const side of ["before", "after"]) {
      const dir = join(root, side), file = "nested/".repeat(depth) + "index.d.ts"
      let source = shape === "member" ? "export interface Environment { readonly env: NodeJS.ProcessEnv }\n"
        : shape === "function" ? "export declare function environment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;\n" : corpus.declaration
      if (side === "after" && changed) source = source.replaceAll("NodeJS.ProcessEnv", "Readonly<Record<string, number>>")
      put(join(dir, file), source)
      put(join(dir, "package.json"), JSON.stringify({ name: "ambient-context-fixture", type: "module", types: "./" + file, exports: { ".": "./" + file } }))
      const compilerOptions = { strict: true, noEmit: true, target: "ESNext", module: "ESNext", moduleResolution: "Bundler" }
      if (layout !== "automatic") compilerOptions.types = ["node"]
      if (types !== undefined) compilerOptions.types = types
      const config = { compilerOptions, files: [file] }
      const typeDirectory = layout === "typeRoots" || layout === "extends" ? "typings" : "node_modules/@types"
      mkdirSync(join(dir, typeDirectory), { recursive: true })
      symlinkSync(nodeTypes, join(dir, typeDirectory, "node"), "dir")
      if (layout === "typeRoots") compilerOptions.typeRoots = ["./typings"]
      if (layout === "extends") {
        put(join(dir, "config/base.json"), JSON.stringify({ compilerOptions: { types: ["node"], typeRoots: ["../typings"] } }))
        delete compilerOptions.types
        config.extends = "./config/base.json"
      }
      put(join(dir, "tsconfig.json"), JSON.stringify(config))
      for (const path of [join(dir, file), join(dir, "tsconfig.json"), join(dir, "package.json")]) inputFiles.push([path, readFileSync(path, "utf8")])
    }
    const a = join(root, "before"), b = join(root, "after")
    const stock = dir => {
      const parsed = ts.getParsedCommandLineOfConfigFile(join(dir, "tsconfig.json"), {}, {
        ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n")) },
      })
      const program = ts.createProgram(parsed.fileNames, parsed.options)
      return ts.getPreEmitDiagnostics(program).map(d => d.code)
    }
    const result = check(a, b, stock)
    for (const [path, text] of inputFiles) assert.equal(readFileSync(path, "utf8"), text, "comparison preserves the input files")
    return result
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function completeEqual(result) {
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}

for (const layout of layouts) test("configured Node types retain self-comparison and snapshot identity: " + layout, () => {
  fixture({ layout }, (a, b, stock) => {
    assert.deepEqual(stock(a), [], "stock TypeScript accepts the original configured declaration")
    assert.deepEqual(stock(b), [], "stock TypeScript accepts its snapshot twin")
    completeEqual(compareDeclarations(ts, a, a))
    completeEqual(compareDeclarations(ts, a, b))
    completeEqual(compareApiIdentity(ts, a, b))
  })
})

test("explicit empty types do not gain an ambient namespace", () => {
  fixture({ types: [] }, (a, b, stock) => {
    assert.ok(stock(a).includes(2503))
    const result = compareDeclarations(ts, a, b)
    assert.equal(result.comparisonComplete, false)
    assert.equal(result.identical, false)
    assert.ok(result.environmentDiagnostics.some(d => /TS2503/.test(d.diagnostic)))
  })
})

test("missing configured type packages remain unavailable", () => {
  fixture({ types: ["missing-ambient-package"] }, (a, b, stock) => {
    assert.ok(stock(a).includes(2688))
    const result = compareDeclarations(ts, a, b)
    assert.equal(result.comparisonComplete, false)
    assert.equal(result.identical, false)
    assert.ok(result.environmentDiagnostics.some(d => /TS2688|TS2503/.test(d.diagnostic)))
  })
})

test("an explicit comparison option overrides automatic project types", () => {
  fixture({}, (a, b, stock) => {
    assert.deepEqual(stock(a), [])
    const result = compareApiIdentity(ts, a, b, { compilerOptions: { types: [] } })
    assert.equal(result.comparisonComplete, false)
    assert.equal(result.identical, false)
  })
})

test("property: configured ambient contexts preserve identity and expose real type changes", async () => {
  await checkProperty(fc, {
    name: corpus.key,
    rule: "001 API identity: use each configured stock TypeScript environment; equal APIs compare completely and changed public types remain different.",
    command: "node --test .smithers/flows/migrate/test/node-ambient-context.property.test.mjs",
    generatorVersion: 1, numRuns: 16,
    arbitrary: fc.record({ layout: fc.constantFrom(...layouts), depth: fc.integer({ min: 0, max: 2 }),
      shape: fc.constantFrom("alias", "member", "function"), changed: fc.boolean() }),
    check: value => fixture(value, (a, b, stock) => {
      assert.deepEqual(stock(a), [])
      assert.deepEqual(stock(b), [])
      const result = compareDeclarations(ts, a, b)
      assert.equal(result.comparisonComplete, true, JSON.stringify(result))
      assert.equal(result.identical, !value.changed, JSON.stringify(result))
      if (value.changed) assert.ok(result.typeDifferences.length, JSON.stringify(result))
    }),
  })
})
