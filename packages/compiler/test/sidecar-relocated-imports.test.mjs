// Coverage census: isolated stock consumer with both skipLibCheck settings and independent public outputs.
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#cc9377c5ce039500
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#8c9c22ad50b11f3b
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#dfe3486b5a2206ef
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#d55b6117cfed4c63
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#f36a561d18bcff1a
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#b944feca23dbac02
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#41ff254a3aa64421
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#37dfe2a6c9c22061
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#aba446722ee056bb
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#7565b2f823ab7a6c
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#f7495f89b1dc1eec
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#8f0d977b8bac9ac3
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#41690708d7aa437b
// VIP-27 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0027-declaration-output.md#78f2f5854636efad
// VIP-30 isolated stock consumer with both skipLibCheck settings and independent public outputs: docs/design/vips/0030-config-files.md#5601d1ca241e6468
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const stock = join(modules, "typescript/bin/tsc")
const ts = createRequire(import.meta.url)(join(modules, "typescript/lib/typescript.js"))
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }

function crossPackage({ output = ".vibe/declarations", nested = "src", helper = "helper", tag = "tag", nativeKind = "file", vibeKind = "file" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-cross-package-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const run = (binary, args, cwd) => spawnSync(binary, args, { cwd: join(root, cwd), encoding: "utf8" })
  try {
    const entry = nativeKind === "dot" ? "entry" : "index"
    const projectOptions = nativeKind === "file" && vibeKind === "file" ? options : { ...options, module: "ESNext", moduleResolution: "Bundler" }
    const helperFile = nativeKind === "dot" ? "index.ts" : nativeKind === "directory" ? helper + "/index.ts" : helper + ".ts"
    const helperSpecifier = nativeKind === "dot" ? "." : "./" + helper + (nativeKind === "file" ? ".ts" : "")
    const tagFile = vibeKind === "directory" ? tag + "/index.vibe" : tag + ".vibe"
    const tagSpecifier = vibeKind === "directory" ? "./" + tag : "./" + tag + ".vibe"
    put("a/package.json", JSON.stringify({ name: "producer", type: "module", types: `./${output}/${nested}/${entry}.d.vibe.ts` }))
    put("a/tsconfig.json", JSON.stringify({ compilerOptions: { ...projectOptions, rootDirs: [".", output] }, include: [nested], vibe: { sidecarDir: output } }))
    put(`a/${nested}/${helperFile}`, "export interface Helper { readonly n: number }\n")
    put(`a/${nested}/${tagFile}`, "export type Tag = { readonly label: string }\n")
    put(`a/${nested}/${entry}.vibe`, `import type { Helper } from "${helperSpecifier}"\nimport type { Tag } from "${tagSpecifier}"\nexport function make(n: number): Helper & Tag { return { n, label: "ok" } }\n`)
    put("b/package.json", '{"type":"module"}')
    put("b/tsconfig.json", JSON.stringify({ compilerOptions: projectOptions, include: ["src"] }))
    put("b/src/main.ts", 'import { make } from "producer"\nexport const wrong: string = make(1).n\nexport const label: string = make(1).label\n')
    mkdirSync(join(root, "b/node_modules"), { recursive: true })
    symlinkSync(join(root, "a"), join(root, "b/node_modules/producer"))
    const emit = run(native, ["-p", "tsconfig.json", "--pretty", "false"], "a")
    assert.equal(emit.status, 0, emit.stdout + emit.stderr)
    for (const skipLibCheck of [false, true]) {
      put("b/tsconfig.json", JSON.stringify({ compilerOptions: { ...projectOptions, skipLibCheck }, include: ["src"] }))
      const checked = run(process.execPath, [stock, "-p", "tsconfig.json", "--pretty", "false"], "b")
      assert.equal(checked.status, 2, checked.stdout + checked.stderr)
      assert.match(checked.stdout, /TS2322: Type 'number' is not assignable to type 'string'/, checked.stdout)
      assert.doesNotMatch(checked.stdout, /TS2307/, checked.stdout)
    }
    return readFileSync(join(root, "a", output, nested, entry + ".d.vibe.ts"), "utf8")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("opencode-53: a different project's stock compiler resolves every relocated import without the producer rootDirs", () => {
  crossPackage()
})

test("property: relocated declarations preserve cross-package native and Vibe sibling types", { timeout: 600000 }, () => {
  // VIP-27: "Declarations are exactly what idiomatic Effect TypeScript would declare."
  // The importing project never inherits the producer's rootDirs (detail 268/271).
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-sidecar-relocated-imports.json", import.meta.url), "utf8"))
  const unicode = JSON.parse(readFileSync(new URL("./corpus/opencode-sidecar-unicode-import.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.record({
    output: fc.constantFrom(".vibe/declarations", "types", "gen/decl"),
    nested: fc.constantFrom("src", "src/deep", "lib/more"),
    helper: fc.constantFrom("helper", "native-types", "Ω", "%CE%A9", "with space", "hash#name"),
    nativeKind: fc.constantFrom("file", "directory", "dot"),
    vibeKind: fc.constantFrom("file", "directory"),
    tag: fc.constantFrom("tag", "Ω-tag", "%CE%A9-tag", "hash#tag", "space tag")
  }), input => { crossPackage(input) }), { examples: [[corpus.input], [unicode.input]], seed: 530268, numRuns: Number(process.env.FC_RUNS || 6) })
})

test("compatibility sidecarDir is independent of native public declarationDir and outDir", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-public-output-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"type":"module"}')
    put("src/main.vibe", "export type Payload = string\n")
    put("tsconfig.json", JSON.stringify({ compilerOptions: {
      ...options, noEmit: false, declaration: true, emitDeclarationOnly: true,
      rootDir: ".", declarationDir: "public", outDir: "js"
    }, include: ["src"], vibe: { sidecarDir: "types" } }))
    const emitted = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
    const publicText = readFileSync(join(root, "public/src/main.d.ts"), "utf8")
    assert.equal(readFileSync(join(root, "types/src/main.d.vibe.ts"), "utf8"), publicText)
    assert.equal(existsSync(join(root, "src/main.d.vibe.ts")), false)
    assert.equal(existsSync(join(root, "types/src/main.d.ts")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("declarations keep filesystem spellings while emitted JavaScript escapes ESM URLs", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-url-spellings-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"type":"module"}')
    const names = ["Ω", "%CE%A9", "with space", "hash#name"]
    for (const [i, name] of names.entries()) put("src/" + name + ".ts", `export interface T${i} { readonly n${i}: number }; export const v${i} = ${i}\n`)
    put("src/main.vibe", names.map((name, i) => `export { type T${i}, v${i} } from "./${name}.ts"`).join("\n"))
    put("tsconfig.json", JSON.stringify({ compilerOptions: {
      ...options, noEmit: false, declaration: true, rootDir: ".", outDir: "js", declarationDir: "public",
      rewriteRelativeImportExtensions: false
    }, include: ["src"] }))
    const emitted = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
    const declarations = readFileSync(join(root, "public/src/main.d.ts"), "utf8")
    const js = readFileSync(join(root, "js/src/main.js"), "utf8")
    const specifiers = text => ts.createSourceFile("main.ts", text, ts.ScriptTarget.Latest, true).statements
      .filter(ts.isExportDeclaration).map(statement => statement.moduleSpecifier.text)
    for (const name of names) {
      assert.ok(specifiers(declarations).includes("./" + name + ".ts"), declarations)
      assert.ok(specifiers(js).includes("./" + encodeURIComponent(name) + ".js"), js)
    }
    put("consumer.ts", 'import { v0, v1, v2, v3 } from "./public/src/main.js"; const values: number[] = [v0, v1, v2, v3];')
    put("consumer.config.json", JSON.stringify({ compilerOptions: options, files: ["consumer.ts"] }))
    const isolated = spawnSync(process.execPath, [stock, "-p", "consumer.config.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(isolated.status, 0, isolated.stdout + isolated.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("relocated sidecars decode escaped Unicode module names", () => { crossPackage({ tag: "Ω-tag" }) })
