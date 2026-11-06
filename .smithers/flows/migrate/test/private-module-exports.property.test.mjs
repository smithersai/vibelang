import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
import { emitPackageJs } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-private-module-wildcard.json", import.meta.url)))
const rule = "It adopts only the named, top-level, unexported declaration."
const write = (root, file, data) => { const p = join(root, file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data) }

test("the private companion oracle quotes VIP-40", () => assert.ok(readFileSync(new URL("../../../../docs/design/vips/0040-module-declarations.md", import.meta.url), "utf8").includes(rule)))

function property({ name = corpus.name, nested = false, authored = false, condition = false, extension = "vibe", outputExtension = "js" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "private-module-exports-"))
  try {
    const stem = (nested ? "src/nested/" : "src/") + name
    const source = "./" + stem + "." + extension, output = "./.vibelang/js/" + stem + "." + extension + ".-24-throw-24-ts." + outputExtension
    const key = "./" + (nested ? "nested/" : "") + name + "." + extension + ".-24-throw-24-ts"
    const pattern = condition ? { types: "./src/*.d.ts", default: "./.vibelang/js/src/*." + outputExtension } : "./.vibelang/js/src/*." + outputExtension
    const original = { name: "private-body-fixture", type: "module", exports: { "./*": pattern, "./protected": null, ...(authored ? { [key]: "./authored.js" } : {}) }, publishConfig: { exports: { "./*": { types: "./dist/*.d.ts", default: "./dist/*.js" }, "./protected": null } } }
    write(root, "package.json", JSON.stringify(original))
    write(root, stem + "." + extension, "export const value = 42\n")
    write(root, output.slice(2), "export const helper = 42\n")
    const moduleOutputs = [{ source, output }]
    routeEmittedExports(root, {}, { moduleOutputs })
    let current = JSON.parse(readFileSync(join(root, "package.json")))
    assert.equal(current.exports[key], authored ? "./authored.js" : null)
    assert.equal(current.publishConfig.exports[key], null)
    assert.deepEqual(current.exports["./*"], pattern)
    assert.equal(current.exports["./protected"], null)
    const once = readFileSync(join(root, "package.json"), "utf8")
    routeEmittedExports(root, {}, { moduleOutputs })
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    routeEmittedExports(root, {}, { restore: true })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))), original)
    assert.equal(existsSync(join(root, ".vibelang/private-module-exports.json")), false)
    // A lookalike filename without an emitted owner receipt is authored code.
    routeEmittedExports(root, {}, { moduleOutputs: [] })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))), original)
    // Re-emission removes only exclusions still owned by this pass.
    routeEmittedExports(root, {}, { moduleOutputs })
    current = JSON.parse(readFileSync(join(root, "package.json"))); current.publishConfig.exports[key] = "./new-authored.js"
    write(root, "package.json", JSON.stringify(current))
    routeEmittedExports(root, {}, { moduleOutputs: [] })
    current = JSON.parse(readFileSync(join(root, "package.json")))
    assert.equal(current.publishConfig.exports[key], "./new-authored.js")
    assert.equal(current.exports[key], authored ? "./authored.js" : undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("Smithers generated throwing-body subpaths stay private in source and publication maps", () => property())
test("property: private output ownership survives conditions, authored entries and restore", async () => {
  await checkProperty(fc, { name: "private-module-wildcards", rule, command: "node --test test/private-module-exports.property.test.mjs", arbitrary: fc.record({ name: fc.constantFrom("Route", "CommandTree", "A_B", "ü", "mixed-name"), nested: fc.boolean(), authored: fc.boolean(), condition: fc.boolean(), extension: fc.constantFrom("vibe", "vibex"), outputExtension: fc.constantFrom("js", "jsx") }), check: property, numRuns: 100, regressions: new URL("./corpus/", import.meta.url) })
})

test("native emitted companions run through their owner but reject package subpath imports", { skip: !process.env.VIBELANG_BINARY && "set VIBELANG_BINARY" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "native-private-module-"))
  try {
    write(root, "package.json", JSON.stringify({ name: "private-body-fixture", type: "module", exports: { "./entry": "./.vibelang/js/src/Route.js", "./*": "./.vibelang/js/src/*.js" }, publishConfig: { exports: { "./*": "./dist/*.js" } } }))
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true }, vibe: { effectGlobals: false, effectModules: false }, files: ["src/Route.vibe"] }))
    write(root, "src/Route.vibe", corpus.source)
    const result = await emitPackageJs({ compiler: process.env.VIBELANG_BINARY, tsconfigs: ["tsconfig.json"], packageDir: root, root })
    assert.equal(result.code, 0, JSON.stringify(result.diagnostics))
    routeEmittedExports(root, result.outputs, { moduleOutputs: result.moduleOutputs })
    const program = 'import { value } from "private-body-fixture/entry"; if(value!==42)throw Error("owner changed"); try { await import("private-body-fixture/Route.vibe.-24-throw-24-ts"); throw Error("private companion became public"); } catch(error) { if(error.code!=="ERR_PACKAGE_PATH_NOT_EXPORTED")throw error; }'
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", program], { cwd: root, encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(result.moduleOutputs.length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("more specific redirects, authored lookalikes and absent ownership remain public", () => {
  const root = mkdtempSync(join(tmpdir(), "authored-module-exports-"))
  try {
    const key = "./Route.vibe.body"
    const manifest = { exports: { "./*": "./.vibelang/js/src/*.js", "./Route*": "./other/Route*.js" } }
    write(root, "package.json", JSON.stringify(manifest))
    const moduleOutputs = [{ source: "./src/Route.vibe", output: "./.vibelang/js/src/Route.vibe.body.js" }]
    routeEmittedExports(root, {}, { moduleOutputs })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))), manifest)
    delete manifest.exports["./Route*"]
    write(root, "package.json", JSON.stringify(manifest))
    write(root, "src/Route.vibe.body.ts", "export const authored = true\n")
    routeEmittedExports(root, {}, { moduleOutputs })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"))), manifest)
    rmSync(join(root, "src/Route.vibe.body.ts"))
    routeEmittedExports(root, {}, { moduleOutputs: [{ source: "./src/Other.vibe", output: moduleOutputs[0].output }] })
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).exports[key], undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("native JSX-preserving companions are private while their emitted bodies stay intact", { skip: !process.env.VIBELANG_BINARY && "set VIBELANG_BINARY" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "private-jsx-module-"))
  try {
    write(root, "package.json", JSON.stringify({ type: "module", exports: { "./*": "./.vibelang/js/src/*.jsx" } }))
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, jsx: "preserve" }, vibe: { effectGlobals: false, effectModules: false }, files: ["src/Route.vibex"] }))
    write(root, "src/Route.vibex", corpus.source)
    const result = await emitPackageJs({ compiler: process.env.VIBELANG_BINARY, tsconfigs: ["tsconfig.json"], packageDir: root, root })
    assert.equal(result.code, 0, JSON.stringify(result.diagnostics))
    const body = result.moduleOutputs[0]
    assert.equal(result.moduleOutputs.length, 1)
    assert.match(body.output, /\.jsx$/)
    assert.equal(result.outputs["./src/Route.vibex"], "./.vibelang/js/src/Route.jsx")
    const bytes = readFileSync(join(root, body.output))
    routeEmittedExports(root, result.outputs, { moduleOutputs: result.moduleOutputs })
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).exports["./Route.vibex.-24-throw-24-ts"], null)
    assert.deepEqual(readFileSync(join(root, body.output)), bytes)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
