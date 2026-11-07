import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const stock = join(modules, "typescript/bin/tsc")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-fix-generated-sidecar.json", import.meta.url), "utf8"))
const options = { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, rootDir: ".", types: [] }

// Chapter 7: "A quick fix is offered only when it preserves evaluation order,
// coldness, types, comments, and declaration output". TypeScript's original
// annotation supplies the same parameter type without importing emit outputs.
function check({ kind, repeats, annotation, parameter }) {
  const dir = mkdtempSync(join(tmpdir(), "fix-generated-sidecar-"))
  const put = (name, text) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text) }
  const run = (args, command = native) => {
    const result = spawnSync(command, args, { cwd: dir, encoding: "utf8", timeout: 60000 })
    assert.ifError(result.error)
    return { ...result, text: result.stdout + result.stderr }
  }
  try {
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(modules, "effect"), join(dir, "node_modules/effect"), "dir")
    symlinkSync(join(repo, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"), "dir")
    put("package.json", '{"type":"module"}')
    const body = 'export class Asset { #value = 1; get value() { return this.#value } }\n/** @throws {never} */ export function make() { return new Asset() }\n'
    const plain = 'export interface Asset { readonly value: number }\nexport function make(): Asset { return { value: 1 } }\n'
    put("media.vibe", kind === "named-body" ? corpus.dependency : plain)
    const param = parameter === "optional" ? `value?: ${annotation}` : parameter === "readonly-rest" ? `...value: ReadonlyArray<${annotation}>` : parameter === "rest" ? `...value: ${annotation}[]` : `value: ${annotation}`
    const source = `import { make } from "./media.vibe"\nexport const work = Effect.fn(function* (${param}) { return value })\n`
    put("main.vibe", source)
    const staged = kind === "staged-source"
    put("tsconfig.json", JSON.stringify({ compilerOptions: { ...options, ...(staged ? { rootDirs: [".", ".vibe/declarations"] } : {}) }, ...(staged ? { vibe: { sidecarDir: ".vibe/declarations" } } : {}), include: ["*.vibe", "*.ts"] }))
    // Stock TypeScript twin: same parameter and source type, ordinary sibling.
    put("media-native.ts", kind === "named-body" ? body : plain)
    put("native.ts", 'import { Effect } from "effect"\n' + source.replace("./media.vibe", "./media-native.js"))
    put("native.json", JSON.stringify({ compilerOptions: options, files: ["native.ts"] }))
    const twin = run([stock, "-p", "native.json", "--pretty", "false"], process.execPath)
    assert.equal(twin.status, 0, twin.text)
    // Exclude the controls from the VibeLang program.
    put("tsconfig.json", JSON.stringify({ compilerOptions: { ...options, ...(staged ? { rootDirs: [".", ".vibe/declarations"] } : {}) }, ...(staged ? { vibe: { sidecarDir: ".vibe/declarations" } } : {}), include: ["main.vibe", "media.vibe", "*.d.ts", "*.d.vibe.ts"] }))
    for (let i = 0; i < repeats; i++) {
      const compiled = run(["-p", ".", "--pretty", "false"])
      assert.doesNotMatch(compiled.text, /TS5055/)
      // Chapter 2: a plain function* stays a JavaScript generator.
      // This valid Effect.fn callback needs no legacy-producer diagnostic.
      assert.equal(compiled.status, 0, compiled.text)
      assert.equal(compiled.text, "", "the original source must compile cleanly before repair")
      assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), source, "checking must not rewrite the generator")
    }
    let fixed
    for (let i = 0; i < repeats; i++) {
      const result = run(["-p", ".", "--fix", "--noEmit", "--declaration", "--pretty", "false", "--singleThreaded"])
      assert.equal(result.status, 0, JSON.stringify({ kind, repeats, annotation, parameter }) + "\n" + result.text)
      assert.doesNotMatch(result.text, /not fixed:|TS5055/)
      const text = readFileSync(join(dir, "main.vibe"), "utf8")
      assert.doesNotMatch(text, /Effect\.fn/)
      assert.ok(text.includes(annotation), text)
      if (fixed !== undefined) assert.equal(text, fixed, "repeat fixes must be idempotent")
      fixed = text
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("opencode named-body corpus compiles twice and fixes twice", { timeout: 120000 }, () => check(corpus.input))

test("property: generated sidecar kinds and repeated fixes retain source types", { timeout: 600000 }, () => {
  fc.assert(fc.property(fc.record({
    kind: fc.constantFrom("named-body", "adjacent-source", "staged-source"),
    repeats: fc.integer({ min: 2, max: 3 }),
    annotation: fc.constantFrom("ReturnType<typeof make>", 'Parameters<(x: ReturnType<typeof make>) => void>[0]'),
    parameter: fc.constantFrom("required", "optional", "rest", "readonly-rest")
  }), check), { seed: 5055, numRuns: Number(process.env.FC_RUNS || 9), examples: [
    [corpus.input],
    [{ ...corpus.input, kind: "adjacent-source" }],
    [{ ...corpus.input, kind: "staged-source", parameter: "optional" }]
  ] })
})

test("author-selected sidecars retain TS5055 and unchanged bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "fix-author-sidecar-"))
  try {
    const sentinel = "export declare const handwritten: unique symbol\n"
    writeFileSync(join(dir, "main.vibe"), "export const value = 1\n")
    writeFileSync(join(dir, "main.d.vibe.ts"), sentinel)
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { ...options, noLib: true },
      vibe: { effectGlobals: false, effectModules: false },
      files: ["main.vibe", "main.d.vibe.ts"]
    }))
    const result = spawnSync(native, ["-p", ".", "--fix", "--pretty", "false"], { cwd: dir, encoding: "utf8" })
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /TS5055/)
    assert.equal(readFileSync(join(dir, "main.d.vibe.ts"), "utf8"), sentinel)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
