import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeEmittedExports, hasVibeSource, hasNativeRuntimeExport } from "../lib/emitted-exports.mjs"
import { emitPackageJs } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const rule = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
const corpusDir = new URL("./corpus/", import.meta.url)
const write = (root, file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }

test("mixed-package export oracle quotes Chapter 7", () => assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(rule)))

function property(input) {
  const root = mkdtempSync(join(tmpdir(), "mixed-native-exports-"))
  try {
    const stem = (input.nested ? "src/deep/" : "src/") + input.name
    const source = "./" + stem + "." + input.extension
    const output = "./.vibelang/js/" + stem + "." + ({ ts: "js", tsx: "jsx", mts: "mjs", cts: "cjs", js: "js" }[input.extension])
    let value = source
    if (input.kind === "condition") value = { types: "./types.d.ts", import: source, require: "./existing.cjs" }
    if (input.kind === "array") value = [source, "./fallback.js"]
    if (input.kind === "pattern") value = source.replace(input.name + ".", "*.")
    const original = { name: "lib", exports: { "./entry": value, "./asset": "./data.json", "./none": null }, imports: { "#native": source } }
    write(root, "package.json", JSON.stringify(original))
    routeEmittedExports(root, { [source]: output })
    const routed = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
    const native = { types: source, "vibelang-source": source, default: output }
    const expected = input.kind === "condition" ? { ...value, import: native } : input.kind === "array" ? [native, "./fallback.js"] : input.kind === "pattern" ? { types: value, "vibelang-source": value, default: output.replace(input.name + ".", "*.") } : native
    assert.deepEqual(routed.exports["./entry"], expected)
    assert.deepEqual(routed.imports["#native"], native)
    assert.equal(routed.exports["./asset"], "./data.json")
    assert.equal(routed.exports["./none"], null)
    const once = readFileSync(join(root, "package.json"), "utf8")
    assert.equal(routeEmittedExports(root, { [source]: output }), false)
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), original, "last-module revert restores the native export shape")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode-50: the untouched TypeScript export is routed beside its migrated dependency", () => property({ name: "app-node", extension: "ts", nested: true, kind: "bare" }))
test("property: native export conditions retain their types, branches and revert shape", async () => {
  await checkProperty(fc, { name: "mixed-native-exports", rule, command: "node --test test/emitted-exports.property.test.mjs", arbitrary: fc.record({
    name: fc.constantFrom("entry", "app-node", "a..b", "ü"), extension: fc.constantFrom("ts", "tsx", "mts", "cts", "js"), nested: fc.boolean(), kind: fc.constantFrom("bare", "condition", "array", "pattern")
  }), check: property, numRuns: 100, regressions: corpusDir })
})

test("production source detection excludes nested packages, tests and generated copies", () => {
  const root = mkdtempSync(join(tmpdir(), "mixed-source-scope-"))
  try {
    write(root, "child/package.json", "{}")
    write(root, "child/a.vibe", "")
    write(root, ".vibelang/a.vibe", "")
    write(root, "test/a.vibe", "")
    write(root, "src/a.test.vibe", "")
    assert.equal(hasVibeSource(root), false)
    write(root, "src/private.vibe", "")
    assert.equal(hasVibeSource(root), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function run(root, command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", timeout: 60000, env: { ...process.env, VIBELANG_BINARY: compiler } })
  return { status: result.status, text: (result.stdout || "") + (result.stderr || "") }
}

async function mixedGraph(extension = "ts", jsx = "react-jsx") {
  const root = mkdtempSync(join(tmpdir(), "opencode-mixed-package-"))
  try {
    const pkg = join(root, "packages/lib")
    const manifest = { name: "lib", type: "module", exports: { "./entry": "./src/entry.ts", "./token": "./src/token." + extension, "./leaf": { types: "./src/leaf.d.vibe.ts", "vibelang-source": "./src/leaf.vibe", default: "./.vibelang/js/src/leaf.js" } } }
    write(root, "package.json", '{"type":"module","workspaces":["packages/*"]}')
    write(root, "packages/lib/package.json", JSON.stringify(manifest))
    write(root, "packages/lib/tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "Preserve", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, noEmit: true, rewriteRelativeImportExtensions: true, jsx, allowJs: extension === "js" }, vibe: { effectGlobals: false, effectModules: false }, include: ["src"] }))
    write(root, "packages/lib/src/token." + extension, "export const token = {}\n")
    write(root, "packages/lib/src/leaf.vibe", 'export { token } from "./token.' + extension + '"\n')
    write(root, "packages/lib/src/entry.ts", 'export { token } from "./leaf.vibe"\n')
    write(root, "main.mjs", 'import { token as a } from "lib/entry"; import { token as b } from "lib/token"; console.log(a === b)\n')
    write(root, "same.mjs", 'import { token as a } from "lib/entry"; import { token as b } from "./packages/lib/src/token.' + extension + '"; console.log(a === b)\n')
    mkdirSync(join(root, "node_modules"), { recursive: true })
    symlinkSync(pkg, join(root, "node_modules/lib"))
    symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect"), join(root, "node_modules/effect"))
    const emitted = await emitPackageJs({ compiler, tsconfigs: [join(pkg, "tsconfig.json")], packageDir: pkg, root, log: join(root, "emit.log") })
    assert.equal(emitted.code, 0, readFileSync(join(root, "emit.log"), "utf8"))
    assert.equal(emitted.outputs["./src/entry.ts"], "./.vibelang/js/src/entry.js")
    const before = run(root, "bun", ["build", "main.mjs", "--target=bun", "--outfile=before.js"])
    assert.notEqual(before.status, 0, "unrouted mixed package must reproduce the file-asset failure")
    assert.match(before.text, /No matching export/)
    assert.equal(routeEmittedExports(pkg, emitted.outputs), true)
    const after = run(root, "bun", ["build", "main.mjs", "--target=bun", "--outfile=after.js"])
    assert.equal(after.status, 0, after.text)
    for (const [command, args] of [
      ["bun", ["after.js"]], ["node", ["main.mjs"]],
      ["bun", ["--preload", "vibelang/bun", "main.mjs"]], ["bun", ["--preload", "vibelang/bun", "same.mjs"]],
      ["node", ["--import", "vibelang/register", "main.mjs"]], ["node", ["--import", "vibelang/register", "same.mjs"]]
    ]) {
      if (extension === "tsx" && command === "node") continue
      const result = run(root, command, args)
      assert.equal(result.status, 0, result.text)
      assert.equal(result.text.trim(), "true", command + " " + args.join(" ") + ": " + result.text)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const extension of ["ts", "tsx", "mts", "js"]) {
  test("opencode-50: unchanged Bun CLI and source loaders share a mixed " + extension + " graph", () => mixedGraph(extension))
}

test("property: mixed native runtime follows each compiler output", async () => {
  await checkProperty(fc, {
    name: "mixed-native-runtime", rule, command: "node --test test/emitted-exports.property.test.mjs",
    arbitrary: fc.record({ extension: fc.constantFrom("ts", "tsx", "mts", "js") }),
    check: input => mixedGraph(input.extension, input.jsx ?? "react-jsx"), numRuns: 4, regressions: corpusDir
  })
})

test("native activation follows runtime exports and leaves type-only or already-built entries alone", () => {
  assert.equal(hasNativeRuntimeExport({ ".": "./src/entry.ts" }), true)
  assert.equal(hasNativeRuntimeExport({ ".": { types: "./src/entry.ts", default: "./dist/entry.js" } }), false)
  assert.equal(hasNativeRuntimeExport(undefined), false)
  assert.equal(hasNativeRuntimeExport({ ".": ["./fallback.js", { import: "./src/entry.mts" }] }), true)
})
