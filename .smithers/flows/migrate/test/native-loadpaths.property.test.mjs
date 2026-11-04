import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const compilerRequire = createRequire(join(repo, "packages/compiler/package.json"))
const fc = require("fast-check")
const ts = loadTypeScript([join(repo, "packages/runtime")])
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const read = (root, file) => readFileSync(join(root, file), "utf8")
const packages = [{ dir: ".", tsconfig: "tsconfig.json", sources: ["src", "db"] }]
const run = (root, file) => spawnSync(process.execPath, [file], { cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } })
const route = root => routeBundledImports({ root, packages, ts, native: true })

for (const [name, runner, diagnostic] of [
  ["smithers-plain-node-migration", "ops/entry.test.ts", /ERR_UNKNOWN_FILE_EXTENSION/],
  ["smithers-test-local-esbuild", "src/tab.test.mjs", /No loader is configured.*\.vibe/]
]) test(name + ": original command and protected test load the migrated graph", t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-native-loadpath-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const files = JSON.parse(readFileSync(new URL("./corpus/" + name + ".json", import.meta.url)))
  for (const [file, text] of Object.entries(files)) put(root, file, text)
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(dirname(compilerRequire.resolve("esbuild/package.json")), join(root, "node_modules/esbuild"))
  // The .ts twin runs with exactly the original command, without a loader.
  const vibe = Object.keys(files).find(file => file.endsWith(".vibe"))
  const native = vibe.replace(/\.vibe$/, ".ts")
  put(root, native, files[vibe])
  for (const [file, text] of Object.entries(files)) if (file.endsWith(".ts")) put(root, file, text.replaceAll(".vibe", ".ts"))
  const entry = name === "smithers-plain-node-migration" ? "db/migrate.ts" : "src/browser.ts"
  put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { noEmit: true, allowImportingTsExtensions: true, module: "NodeNext", target: "ES2022", skipLibCheck: true, types: [] }, files: [entry] }))
  const checked = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
  assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  const twin = run(root, runner)
  assert.equal(twin.status, 0, twin.stderr)
  rmSync(join(root, native))
  for (const [file, text] of Object.entries(files)) put(root, file, text)
  const failed = run(root, runner)
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, diagnostic)
  const result = route(root)
  assert.ok(result.modules.includes(vibe), JSON.stringify(result))
  const passed = run(root, runner)
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(read(root, runner), files[runner], "target test stays byte-identical")
  assert.deepEqual(route(root).changed, [], "routing is idempotent")
  routeBundledImports({ root, packages, ts, restore: true })
  for (const [file, text] of Object.entries(files)) assert.equal(read(root, file), text, file)
})

test("native load paths: runtime import forms work, type-only and protected sources stay unchanged", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("import", "export", "dynamic"),
    fc.constantFrom("ts", "mts", "tsx"),
    fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/),
    fc.integer({ min: -1000, max: 1000 }),
    async (form, ext, name, answer) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-native-property-"))
      try {
        put(root, "package.json", JSON.stringify({ name: "fixture", private: true, type: "module" }, null, 2) + "\n")
        const specifier = "./nested/" + name + ".vibe"
        const body = form === "import" ? 'import { value } from "' + specifier + '"\nexport { value }\n'
          : form === "export" ? 'export { value } from "' + specifier + '"\n'
          : 'export const { value } = await import("' + specifier + '")\n'
        put(root, "src/index." + ext, body)
        put(root, "src/nested/" + name + ".vibe", "export const value: number = " + answer + "\n")
        put(root, ".vibelang/js/src/nested/" + name + ".js", "export const value = " + answer + "\n")
        const protectedText = 'export { value } from "' + specifier + '"\n'
        put(root, "src/unchanged.test.ts", protectedText)
        const typeText = 'import type { value } from "' + specifier + '"\n'
        put(root, "src/types.ts", typeText)
        route(root)
        assert.match(read(root, "src/index." + ext), /#vibelang\/emitted\//)
        assert.equal(read(root, "src/unchanged.test.ts"), protectedText)
        assert.equal(read(root, "src/types.ts"), typeText)
        // esbuild consumes every native extension; its call and options are unchanged.
        const { build } = compilerRequire("esbuild")
        const bundle = await build({ entryPoints: [join(root, "src/index." + ext)], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" })
        const actual = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"))
        assert.equal(actual.value, answer)
        assert.deepEqual(route(root).changed, [])
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 20261103, numRuns: 60 })
})

test("native load paths: no invented outputs, nested-package edits or test-only helper edits", t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-native-ownership-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, "package.json", JSON.stringify({ type: "module" }, null, 2) + "\n")
  const body = 'export { value } from "./value.vibe"\n'
  put(root, "src/index.ts", body)
  put(root, "src/value.vibe", "export const value = 1\n")
  const missing = routeBundledImports({ root, packages, ts, native: true, outputs: {} })
  assert.equal(read(root, "src/index.ts"), body)
  assert.match(missing.warnings[0], /src\/index.ts:1: missing emitted JavaScript for src\/value.vibe/)
  // A stale guessed filename must not substitute for the compiler's output map.
  put(root, ".vibelang/js/src/value.js", "export const value = 999\n")
  assert.deepEqual(routeBundledImports({ root, packages, ts, native: true, outputs: {} }).changed, [])
  put(root, "src/test-helper.ts", body)
  put(root, "src/owner.test.ts", 'import "./test-helper.ts"\n')
  put(root, "child/package.json", '{"type":"module"}\n')
  put(root, "child/index.ts", 'export { value } from "../src/value.vibe"\n')
  put(root, ".vibelang/js/src/actual.js", "export const value = 1\n")
  const result = routeBundledImports({ root, packages, ts, native: true, outputs: { "src/value.vibe": ".vibelang/js/src/actual.js" } })
  assert.ok(result.changed.includes("src/index.ts"))
  assert.equal(read(root, "src/test-helper.ts"), body)
  assert.equal(read(root, "child/index.ts"), 'export { value } from "../src/value.vibe"\n')
  const json = JSON.parse(read(root, "package.json"))
  assert.equal(json.imports["#vibelang/emitted/src/value"].default, "./.vibelang/js/src/actual.js")
})

// Revert is also used with a CLI-only or unavailable toolchain. Only actual
// emitted import-map entries require its TypeScript API, not ordinary imports
// or a description containing the reserved prefix.
test("native load paths: revert restores routed and unrouted packages without an opt-in", async () => {
  const { makeConfig, paths, revert } = await import("../lib/steps.mjs")
  const { renameBatch, rewriteImports } = await import("../lib/codemod.mjs")
  const Jj = await import("../lib/jj.mjs")
  const { must, writeJson } = await import("../lib/util.mjs")
  await fc.assert(fc.asyncProperty(
    fc.boolean(), fc.constantFrom(".", "packages/private"),
    fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/).filter(name => name !== "index"),
    async (routed, directory, name) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-native-revert-"))
      const target = join(root, "repo"), runDir = join(root, "run")
      const relative = file => directory === "." ? file : directory + "/" + file
      try {
        put(target, "package.json", "{}\n")
        const manifest = JSON.stringify({ private: true, type: "module",
          description: "#vibelang/emitted/ is not an import entry",
          imports: { "#ordinary": "./src/index.ts" }
        }, null, 2) + "\n"
        put(target, relative("package.json"), manifest)
        const source = relative("src/" + name + ".ts")
        const importer = relative("src/index.ts")
        const original = "export const value = 42\n"
        const consumer = 'export { value } from "./' + name + '.ts"\n'
        put(target, source, original)
        put(target, importer, consumer)
        await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
        await Jj.commit(target, "original TypeScript")
        writeJson(paths(runDir).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11", packages: [directory] }))
        writeJson(paths(runDir).plan, { batches: [{ files: [source] }] })
        const renames = renameBatch(target, [source])
        const importEdits = rewriteImports(target, [importer, renames[0].to])
        writeJson(paths(runDir).codemod("01"), { renames, importEdits })
        if (routed) {
          mkdirSync(join(target, "node_modules"), { recursive: true })
          symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
          put(target, relative(".vibelang/js/src/" + name + ".js"), "export const value = 42\n")
          routeBundledImports({ root: target, packages: [{ dir: directory }], ts, native: true })
          assert.match(read(target, importer), /#vibelang\/emitted\//)
        }
        await revert({ run: runDir, batch: "01", file: renames[0].to, reason: "native route restoration witness" })
        assert.equal(read(target, source), original)
        assert.equal(read(target, importer), consumer)
        assert.equal(read(target, relative("package.json")), manifest)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 20261104, numRuns: 20 })
})

test("native load paths: empty emission preserves CLI-only packages", async () => {
  const { emitMigratedJs } = await import("../lib/steps.mjs")
  for (const selected of [[], ["."], ["packages/private"]]) {
    const root = mkdtempSync(join(tmpdir(), "migrate-native-empty-"))
    try {
      const manifest = JSON.stringify({ private: true, description: "#vibelang/emitted/ is not an import entry" }) + "\n"
      put(root, "package.json", manifest)
      for (const directory of selected) {
        put(root, directory + "/package.json", manifest)
        put(root, directory + "/src/original.ts", "export const value = 42\n")
      }
      const config = { target: root, toolchain: { kind: "installed" }, packages: selected.map(dir => ({ dir, tsconfig: "tsconfig.json", sources: ["src"] })) }
      assert.deepEqual(await emitMigratedJs(config, root, join(root, ".logs")), [])
      for (const directory of selected) assert.equal(read(root, directory + "/package.json"), manifest)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
