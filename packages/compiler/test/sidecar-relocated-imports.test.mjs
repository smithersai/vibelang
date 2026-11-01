import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
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
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }

function crossPackage({ output = ".vibe/declarations", nested = "src", helper = "helper", nativeKind = "file", vibeKind = "file" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "sidecar-cross-package-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  const run = (binary, args, cwd) => spawnSync(binary, args, { cwd: join(root, cwd), encoding: "utf8" })
  try {
    const entry = nativeKind === "dot" ? "entry" : "index"
    const projectOptions = nativeKind === "file" && vibeKind === "file" ? options : { ...options, module: "ESNext", moduleResolution: "Bundler" }
    const helperFile = nativeKind === "dot" ? "index.ts" : nativeKind === "directory" ? helper + "/index.ts" : helper + ".ts"
    const helperSpecifier = nativeKind === "dot" ? "." : "./" + helper + (nativeKind === "file" ? ".ts" : "")
    const tagFile = vibeKind === "directory" ? "tag/index.vibe" : "tag.vibe"
    const tagSpecifier = vibeKind === "directory" ? "./tag" : "./tag.vibe"
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
  // VIP-27 compatibility declarations must let stock TypeScript read a module's types.
  // The importing project never inherits the producer's rootDirs (detail 268/271).
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-sidecar-relocated-imports.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.record({
    output: fc.constantFrom(".vibe/declarations", "types", "gen/decl"),
    nested: fc.constantFrom("src", "src/deep", "lib/more"),
    helper: fc.constantFrom("helper", "native-types"),
    nativeKind: fc.constantFrom("file", "directory", "dot"),
    vibeKind: fc.constantFrom("file", "directory")
  }), input => { crossPackage(input) }), { examples: [[corpus.input]], seed: 530268, numRuns: Number(process.env.FC_RUNS || 6) })
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

