import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { test } from "node:test"
import { sidecarOf } from "../lib/codemod.mjs"
import { addSidecarDir } from "../lib/enumerations.mjs"
import { removeSupersededSidecars, sidecarSettings } from "../lib/sidecar-config.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-rooted-sidecar-planning.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const withoutPrograms = new Proxy(ts, { get(target, key) {
  if (key === "createProgram") return () => { throw new Error("path planning loaded a complete program") }
  return Reflect.get(target, key)
} })
const fixture = (t, input = {}) => {
  const root = mkdtempSync(join(tmpdir(), "rooted-sidecar-planning-"))
  t?.after(() => rmSync(root, { recursive: true, force: true }))
  const source = input.source ?? "src", output = input.output ?? ".vibe/declarations", module = input.module ?? "main"
  put(root, "package.json", '{"type":"module"}')
  put(root, join(source, module + ".vibe"), "export const value = 1\n")
  put(root, join(source, module + ".d.vibe.ts"), "export declare const stale: 0;\n")
  put(root, join(source, "unrelated.d.vibe.ts"), "export declare const untouched: 1;\n")
  const config = { compilerOptions: { rootDir: source, noEmit: true }, files: [source + "/" + module + ".vibe"], vibe: { sidecarDir: output } }
  put(root, "tsconfig.json", JSON.stringify(config))
  return { root, source, output, module, config, tracked: ["tsconfig.json", source + "/" + module + ".vibe", source + "/" + module + ".d.vibe.ts", source + "/unrelated.d.vibe.ts"] }
}
test("explicit sidecar roots prepare configuration without loading source programs", t => {
  const f = fixture(t), file = join(f.root, "tsconfig.json"), before = readFileSync(file, "utf8")
  const after = addSidecarDir(before, withoutPrograms, ".vibe/declarations", file)
  assert.deepEqual(JSON.parse(after).compilerOptions.rootDirs, ["src", ".vibe/declarations"])
})
test("sidecar path lookup reads only the configured root boundary", t => {
  const f = fixture(t), file = join(f.root, "tsconfig.json")
  const settings = sidecarSettings(file, withoutPrograms, undefined, { sourceRootOnly: true })
  assert.equal(settings.sourceRoot, join(f.root, "src"))
  assert.equal(settings.directory, join(f.root, ".vibe/declarations"))
})
test("fully rooted sidecar cleanup avoids transitive source programs", t => {
  const f = fixture(t)
  assert.deepEqual(removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], withoutPrograms), ["src/main.d.vibe.ts"])
  assert.equal(existsSync(join(f.root, "src/main.d.vibe.ts")), false)
  assert.equal(readFileSync(join(f.root, "src/main.vibe"), "utf8"), "export const value = 1\n")
  assert.equal(readFileSync(join(f.root, "src/unrelated.d.vibe.ts"), "utf8"), "export declare const untouched: 1;\n")
})
test("import-only native sources retain the complete compiling graph", t => {
  const f = fixture(t)
  put(f.root, "src/main.vibe", 'import { value } from "./imported.vibe"\nexport { value }\n')
  put(f.root, "src/imported.vibe", "export const value = 1\n")
  put(f.root, "src/imported.d.vibe.ts", "export declare const value: 0;\n")
  f.tracked.push("src/imported.vibe", "src/imported.d.vibe.ts")
  assert.deepEqual(removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], ts), ["src/imported.d.vibe.ts", "src/main.d.vibe.ts"])
})
test("overlapping sidecar layouts retain selected adjacent outputs", t => {
  const f = fixture(t, { source: ".", output: "src" })
  put(f.root, "src/main.vibe", "export const nested = 2\n")
  put(f.root, "src/main.d.vibe.ts", "export declare const selected: 1;\n")
  put(f.root, "tsconfig.json", JSON.stringify({ ...f.config, files: ["main.vibe", "src/main.vibe"] }))
  f.tracked.push("src/main.vibe", "src/main.d.vibe.ts")
  removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], ts)
  assert.equal(readFileSync(join(f.root, "src/main.d.vibe.ts"), "utf8"), "export declare const selected: 1;\n")
})
test("rooted sidecar corpus quotes the declaration layout rule", () => {
  const chapter = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(chapter.includes(corpus.quote))
})
test("property: fixed-root metadata and cleanup agree with complete graph roots", () => {
  fc.assert(fc.property(fc.record({
    source: fc.constantFrom(".", "src", "lib/source", "input"),
    output: fc.constantFrom(".vibe/declarations", "types", "generated/types"),
    module: fc.constantFrom("main", "multi.part", "Ω"),
    composite: fc.boolean()
  }), input => {
    const f = fixture(null, input)
    try {
      if (input.composite) {
        f.config.compilerOptions = { noEmit: true, composite: true }
        put(f.root, "tsconfig.json", JSON.stringify(f.config))
      }
      const file = join(f.root, "tsconfig.json"), full = sidecarSettings(file, ts)
      const after = addSidecarDir(readFileSync(file, "utf8"), withoutPrograms, ".vibe/declarations", file)
      const options = JSON.parse(after).compilerOptions
      assert.deepEqual(options.rootDirs, [input.composite ? "." : input.source, input.output])
      const path = join(f.root, input.source, input.module + ".vibe")
      assert.ok(full.sources.includes(path))
      assert.equal(full.sourceRoot, resolve(f.root, input.composite ? "." : input.source))
      const removed = removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], withoutPrograms)
      assert.deepEqual(removed, [(input.source === "." ? "" : input.source + "/") + input.module + ".d.vibe.ts"])
      assert.equal(readFileSync(path, "utf8"), "export const value = 1\n")
      assert.equal(readFileSync(join(f.root, input.source, "unrelated.d.vibe.ts"), "utf8"), "export declare const untouched: 1;\n")
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }), { examples: [[corpus.input]], seed: corpus.seed, numRuns: Number(process.env.FC_RUNS || 64) })
})

test("direct roots do not take ownership of a referenced native source", t => {
  const f = fixture(t, { source: "." })
  put(f.root, "owned/main.vibe", "export const other = 2\n")
  put(f.root, "owned/main.d.vibe.ts", "export declare const keep: 1;\n")
  put(f.root, "owned/tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "." }, files: ["main.vibe"] }))
  put(f.root, "tsconfig.json", JSON.stringify({ ...f.config, files: ["main.vibe", "owned/main.vibe"], references: [{ path: "./owned" }] }))
  f.tracked.push("owned/main.vibe", "owned/main.d.vibe.ts")
  assert.deepEqual(removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], ts), ["main.d.vibe.ts"])
  assert.equal(readFileSync(join(f.root, "owned/main.d.vibe.ts"), "utf8"), "export declare const keep: 1;\n")
})
test("inferred roots retain imported sources outside the selected folder", t => {
  const f = fixture(t)
  put(f.root, "src/main.vibe", 'import { other } from "../shared/other.vibe"\nexport { other }\n')
  put(f.root, "shared/other.vibe", "export const other = 2\n")
  put(f.root, "shared/other.d.vibe.ts", "export declare const stale: 0;\n")
  put(f.root, "tsconfig.json", JSON.stringify({ ...f.config, compilerOptions: { noEmit: true } }))
  f.tracked.push("shared/other.vibe", "shared/other.d.vibe.ts")
  assert.equal(sidecarSettings(join(f.root, "tsconfig.json"), ts, undefined, { sourceRootOnly: true }).sourceRoot, f.root)
  assert.deepEqual(removeSupersededSidecars(f.root, f.tracked, ["tsconfig.json"], ts), ["shared/other.d.vibe.ts", "src/main.d.vibe.ts"])
})

test("package sidecar targets do not load a rooted source program", t => {
  const f = fixture(t)
  put(f.root, "node_modules/typescript/package.json", JSON.stringify({ name: "typescript", main: "index.cjs" }))
  put(f.root, "node_modules/typescript/index.cjs", "const ts=require(" + JSON.stringify(require.resolve("typescript")) + ");module.exports=new Proxy(ts,{get(target,key){if(key==='createProgram')return()=>{throw Error('unexpected graph')};return Reflect.get(target,key)}})")
  assert.equal(sidecarOf(f.root, ".")("./src/main"), "./.vibe/declarations/main.d.vibe.ts")
})
test("cleanup deduplicates equivalent tracked paths", t => {
  const f = fixture(t)
  assert.deepEqual(removeSupersededSidecars(f.root, [...f.tracked, ...f.tracked, "./src/main.vibe"], ["tsconfig.json"], withoutPrograms), ["src/main.d.vibe.ts"])
  assert.equal(readFileSync(join(f.root, "src/main.vibe"), "utf8"), "export const value = 1\n")
})

test("directory-only settings do not infer an unused common root", t => {
  const f = fixture(t)
  put(f.root, "tsconfig.json", JSON.stringify({ ...f.config, compilerOptions: { noEmit: true } }))
  const settings = sidecarSettings(join(f.root, "tsconfig.json"), withoutPrograms, undefined, { directoryOnly: true })
  assert.equal(settings.directory, join(f.root, ".vibe/declarations"))
  assert.equal(settings.sourceRoot, undefined)
})
