import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { spawnSync } from "node:child_process"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const runtimeRequire = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const nodeTypes = dirname(runtimeRequire.resolve("@types/node/package.json"))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-implicit-root-context.json", import.meta.url)))
const put = (root, file, value) => {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value))
}
test("implicit-root context oracle quotes the declaration identity contract", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(corpus.quote))
})
function witness({ layout = "native", depth = 0, extension = ".ts", prefix = ".", nestedConfig = false, mutation = "same", native = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "implicit-root-context-")), snapshots = [], bytes = []
  const configDirectory = nestedConfig ? "project/" : ""
  const directory = "src/" + "nested/".repeat(depth), source = configDirectory + directory + "index" + extension
  const declaration = "index" + (extension === ".mts" ? ".d.mts" : extension === ".cts" ? ".d.cts" : ".d.ts")
  try {
    for (const side of ["before", "after"]) {
      const pkg = join(root, side, "package"), snapshot = join(root, side, "snapshot")
      mkdirSync(snapshot, { recursive: true })
      mkdirSync(join(pkg, "node_modules/@types"), { recursive: true })
      symlinkSync(nodeTypes, join(pkg, "node_modules/@types/node"), "dir")
      const output = layout === "stock" ? declaration : directory + declaration
      put(pkg, "package.json", { name: "implicit-root-fixture", type: "module", types: "./dist/" + output })
      put(pkg, source, corpus.source)
      const config = configDirectory + "tsconfig.json", up = nestedConfig ? "../" : ""
      const compilerOptions = { strict: true, skipLibCheck: true, target: "ESNext", ...corpus.compilerOptions,
        ...(layout === "explicit" ? { rootDir: "." } : {}), outDir: up + "dist", declaration: true }
      put(pkg, config, { compilerOptions, files: [directory + "index" + extension] })
      const parsed = ts.getParsedCommandLineOfConfigFile(join(pkg, config), {}, { ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: d => { throw Error(String(d.code)) } })
      assert.deepEqual(parsed.errors.map(d => d.code), [])
      if (native) {
        const binary = resolve(process.env.VIBELANG_BINARY ?? "packages/compiler/native/vibelang")
        const emitted = spawnSync(binary, ["--singleThreaded", "-p", config, "--noEmit", "false", "--declaration",
          "--emitDeclarationOnly", "--composite", "false", "--incremental", "false", "--noEmitOnError", "false",
          "--pretty", "false", "--outDir", join(snapshot, prefix)], { cwd: pkg, encoding: "utf8" })
        assert.equal(emitted.error, undefined)
        assert.ok(emitted.status === 0 || (emitted.status === 2 && /TS5011/.test(emitted.stdout)),
          emitted.stdout + emitted.stderr)
      } else {
        // Produce both native config-directory and stock common-source layouts
        // with real declaration emit, keeping the authored config unchanged.
        const program = ts.createProgram(parsed.fileNames, { ...parsed.options,
          ...(layout === "native" ? { rootDir: join(pkg, configDirectory) } : {}), outDir: join(snapshot, prefix), emitDeclarationOnly: true })
        assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
        assert.equal(program.emit().emitSkipped, false)
      }
      const file = join(snapshot, prefix, output), original = readFileSync(file, "utf8")
      const surface = recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: config, prefix }])
      assert.deepEqual(surface.apiMetadata.projectContexts[0].files, [join(prefix, output).replace(/^\.\//, "")],
        "every actual declaration retains its original project context")
      assert.equal(surface.apiMetadata.aliases[source], join(prefix, output).replace(/^\.\//, ""))
      assert.equal(surface.apiMetadata.projectContexts[0].outputLayout.matched, 1)
      assert.equal(surface.apiMetadata.projectContexts[0].outputLayout.unassigned, 0)
      assert.equal(readFileSync(file, "utf8"), original)
      let text = original
      if (side === "after" && mutation === "type") text = text.replace("NodeJS.ProcessEnv", "number")
      if (side === "after" && mutation === "docs") text = text.replace("Reads", "Retrieves")
      if (mutation === "missingAmbient") {
        surface.apiMetadata.projectContexts[0].compilerOptions.types = []
        put(snapshot, "public-surface.json", surface)
      }
      writeFileSync(file, text)
      bytes.push([file, text])
      put(pkg, config, { compilerOptions: { types: [] }, files: [] })
      snapshots.push(snapshot)
    }
    const result = compareDeclarations(ts, ...snapshots)
    assert.equal(result.comparisonComplete, mutation !== "missingAmbient", JSON.stringify(result))
    assert.equal(result.identical, mutation === "same", JSON.stringify(result))
    if (mutation === "type") assert.ok(result.typeDifferences.length, JSON.stringify(result))
    if (mutation === "docs") assert.ok(result.docDifferences.length, JSON.stringify(result))
    if (mutation === "missingAmbient") assert.ok(result.environmentDiagnostics.length, JSON.stringify(result))
    for (const [file, text] of bytes) assert.equal(readFileSync(file, "utf8"), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("native implicit-root declarations retain Node ambient context", () => witness({ native: true }))
test("native nested config owns its emitted declarations", () => witness({ native: true, nestedConfig: true }))
for (const layout of ["native", "stock", "explicit"]) for (const mutation of ["same", "type", "docs", "missingAmbient"])
  test(layout + " output context preserves " + mutation + " API results", () => witness({ layout, mutation, depth: 1, prefix: "esm" }))
test("property: implicit-root output contexts survive nested sources and independent prefixes", async () => {
  await checkProperty(fc, { name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/implicit-root-context.property.test.mjs", numRuns: 16,
    arbitrary: fc.record({ layout: fc.constantFrom("native", "stock", "explicit"), depth: fc.integer({ min: 0, max: 2 }),
      extension: fc.constantFrom(".ts", ".tsx", ".mts", ".cts"), prefix: fc.constantFrom(".", "esm"), nestedConfig: fc.boolean(),
      mutation: fc.constantFrom("same", "type", "docs", "missingAmbient") }), check: witness })
})


test("ambiguous inferred layouts refuse to assign a declaration to the wrong sibling", () => {
  const root = mkdtempSync(join(tmpdir(), "ambiguous-root-context-"))
  try {
    const pkg = join(root, "package"), snapshot = join(root, "snapshot")
    put(pkg, "package.json", { name: "ambiguous-root-fixture", type: "module" })
    put(pkg, "src/index.ts", "export const outer = 1;")
    put(pkg, "src/src/index.ts", "export const inner = 2;")
    put(pkg, "tsconfig.json", { compilerOptions: { types: [], declaration: true, outDir: "dist" }, include: ["src"] })
    // A partial emit could match either source under the two inferred roots.
    put(snapshot, "src/index.d.ts", "export declare const outer: 1;")
    assert.throws(() => recordDeclarationSurface(ts, snapshot, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }]),
      /ambiguous declaration output layout.*tsconfig.json/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
