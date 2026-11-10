import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { addCompilerScripts } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const repo = resolve(new URL("../../../../", import.meta.url).pathname)
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-native-js-checker.json", import.meta.url)))
const quote = "NodeNext " + String.fromCharCode(96) + "./user.js" + String.fromCharCode(96) + " can resolve to " + String.fromCharCode(96) + "user.vibe" + String.fromCharCode(96) + "."

test("Bun-check resolver oracle remains quoted in Chapter 7", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(quote))
})

function check({ spelling, resolution, importer, depth = 0 }) {
  const root = mkdtempSync(join(tmpdir(), "migrate-bun-check-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"type":"module"}')
    const module = resolution === "bundler" ? "ESNext" : resolution
    const options = { strict: true, target: "ES2022", module, moduleResolution: resolution,
      noEmit: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true, types: [], skipLibCheck: false }
    const stem = ["src", ...Array.from({ length: depth }, (_, i) => "d" + i), "leaf"].join("/")
    const suffix = spelling === "extensionless" ? "" : spelling
    const specifier = "./" + stem + suffix
    const twinSpecifier = spelling === ".vibe" ? "./" + stem + ".ts" : specifier
    const text = name => importer === ".d.ts"
      ? 'export type Output = typeof import("' + name + '").value;\n'
      : 'import { value } from "' + name + '"; export const output: number = value;\n'
    const consumer = "consumer" + (importer === ".vibe" ? ".ts" : importer)
    put(stem + ".ts", "export const value = 42;\n")
    put(consumer, text(twinSpecifier))
    put("tsconfig.json", JSON.stringify({ compilerOptions: options, files: [consumer],
      vibe: { effectGlobals: false, effectModules: false, sidecarDir: ".vibe/declarations" } }))
    const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => assert.fail(String(d.messageText)) })
    const native = ts.createProgram(parsed.fileNames, parsed.options)
    const errors = ts.getPreEmitDiagnostics(native).filter(d => d.category === ts.DiagnosticCategory.Error)
    const nativeCodes = [...new Set(errors.map(d => d.code))].sort()
    const expectedMissing = [".mjs", ".cjs"].includes(spelling) || (spelling === "extensionless" && resolution !== "bundler")
    assert.equal(errors.length === 0, !expectedMissing, JSON.stringify({ spelling, resolution, importer, nativeCodes }))
    renameSync(join(root, stem + ".ts"), join(root, stem + ".vibe"))
    put(consumer, text(specifier))
    let migrated = consumer
    if (importer === ".vibe") {
      migrated = "consumer.vibe"
      renameSync(join(root, consumer), join(root, migrated))
    }
    options.rootDirs = [".", ".vibe/declarations"]
    put("tsconfig.json", JSON.stringify({ compilerOptions: options, files: [migrated],
      vibe: { effectGlobals: false, effectModules: false, sidecarDir: ".vibe/declarations" } }))
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    symlinkSync(compiler, join(root, "node_modules/.bin/vibelang"))
    const pkg = addCompilerScripts({ scripts: { typecheck: "bun check --no-script" } }, "unused")
    assert.equal(pkg.scripts.typecheck, "vibelang --noEmit")
    const result = spawnSync("sh", ["-c", pkg.scripts.typecheck + " --pretty false"], { cwd: root, encoding: "utf8", timeout: 60000,
      env: { ...process.env, PATH: join(root, "node_modules/.bin") + ":" + process.env.PATH, GOMAXPROCS: "2" } })
    assert.ifError(result.error)
    assert.equal(result.signal, null)
    const output = result.stdout + result.stderr
    const migratedCodes = [...new Set([...output.matchAll(/error TS(\d+):/g)].map(m => Number(m[1])))].sort()
    assert.equal(result.status === 0, errors.length === 0, output + JSON.stringify({ spelling, resolution, importer, nativeCodes }))
    if (expectedMissing) {
      // TS2835 adds a filename suggestion to TS2834; both enforce the same
      // native ESM extension rule. A .vibe target need not suggest a .ts name.
      const category = codes => codes.map(code => code === 2835 ? 2834 : code)
      assert.deepEqual(category(migratedCodes), category(nativeCodes), output)
    }
    if (spelling === ".js" && importer === ".ts") {
      const stock = ts.createProgram([join(root, migrated)], { ...parsed.options, rootDirs: options.rootDirs.map(dir => join(root, dir)) })
      const stockErrors = ts.getPreEmitDiagnostics(stock).filter(d => d.category === ts.DiagnosticCategory.Error)
      assert.deepEqual(stockErrors.map(d => d.code), nativeCodes,
        "the native forwarding declaration must preserve the stock checker's original resolution")
    }
    if (!expectedMissing && importer === ".ts") {
      put(migrated, text(specifier).replace("output: number", "output: string"))
      const bad = spawnSync(compiler, ["--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
      assert.match(bad.stdout + bad.stderr, /TS2322/)
      if (spelling === ".js") {
        const stock = ts.createProgram([join(root, migrated)], { ...parsed.options, rootDirs: options.rootDirs.map(dir => join(root, dir)) })
        assert.ok(ts.getPreEmitDiagnostics(stock).some(d => d.code === 2322),
          "the stock importer must retain the forwarded export's type")
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("native JavaScript importer checks its forwarded export in stock TypeScript", () => check(corpus.input))

test("opencode original .js import and all spelling/resolution/importer cells match TypeScript", () => {
  for (const resolution of ["bundler", "node16", "nodenext"])
    for (const importer of [".ts", ".vibe", ".d.ts"])
      for (const spelling of [".js", ".mjs", ".cjs", "extensionless", ".vibe"])
        check({ resolution, importer, spelling })
  console.log("stock TypeScript " + ts.version + ": 45 native controls and unchanged migrated importer checks")
})

test("property: forced checker preserves native resolution through nested source paths", () => {
  fc.assert(fc.property(fc.record({
    spelling: fc.constantFrom(".js", ".mjs", ".cjs", "extensionless", ".vibe"),
    resolution: fc.constantFrom("bundler", "node16", "nodenext"),
    importer: fc.constantFrom(".ts", ".vibe", ".d.ts"), depth: fc.integer({ min: 0, max: 3 })
  }), check), { examples: [[corpus.input]], seed: 46046, numRuns: 30 })
})
