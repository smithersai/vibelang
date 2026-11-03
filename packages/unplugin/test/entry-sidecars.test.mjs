import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import plugin from "../src/rolldown.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const rule = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."
function options(input, extra = {}) {
  const hook = plugin({ root: repo }).options
  return (typeof hook === "function" ? hook : hook.handler).call({}, { input, ...extra })
}

test("sidecar entry filtering quotes the source interoperability rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(rule))
})

for (const [name, input, expected] of [
  ["missing input", undefined, undefined],
  ["single TypeScript source", "entry.ts", "entry.ts"],
  ["single VibeLang source", "entry.vibe", "entry.vibe"],
  ["single generated declaration", "entry.d.vibe.ts", []],
  ["array order and duplicates", ["b.vibe", "a.d.vibe.ts", "b.vibe", "a.ts"], ["b.vibe", "b.vibe", "a.ts"]],
  ["named entries", { first: "a.ts", declaration: "a.d.vibe.ts", second: "b.vibe" }, { first: "a.ts", second: "b.vibe" }],
  ["query suffix", ["a.d.vibe.ts?raw", "a.vibe?raw"], ["a.vibe?raw"]],
  ["ordinary declarations and lookalikes", ["a.d.ts", "a.d.vibe.ts.vibe", "a.d.vibe.ts.js"], ["a.d.ts", "a.d.vibe.ts.vibe", "a.d.vibe.ts.js"]]
]) {
  test("Rolldown entry filtering: " + name, () => {
    const original = structuredClone(input)
    if (input && typeof input === "object") Object.freeze(input)
    const output = options(input, { platform: "node", resolve: { alias: { original: "kept" }, conditionNames: ["custom"] } })
    assert.deepEqual(output.input, expected)
    assert.deepEqual(input, original, "the supplied entry list is not mutated")
    assert.deepEqual(output.resolve, { alias: { original: "kept" }, conditionNames: ["vibelang-source", "custom"] })
    assert.equal(output.platform, "node")
  })
}

test("property: generated sidecars cannot replace source entries or their aliases", async () => {
  await checkProperty(fc, {
    name: "RolldownSidecarEntries", rule,
    command: "node --test packages/unplugin/test/entry-sidecars.test.mjs",
    numRuns: 120,
    arbitrary: fc.record({
      names: fc.uniqueArray(fc.constantFrom("Plugin", "nested/HttpServer", "RuntimeError.shared", "λ", "has space", "ordinary"), { minLength: 1, maxLength: 6 }),
      shape: fc.constantFrom("array", "map"), reversed: fc.boolean()
    }),
    check(input) {
      const sources = input.names.map(name => "src/" + name + ".vibe")
      const all = sources.flatMap(source => [source.replace(/\.vibe$/, ".d.vibe.ts"), source])
      if (input.reversed) all.reverse()
      const expected = all.filter(source => sources.includes(source))
      if (input.shape === "array") assert.deepEqual(options(Object.freeze(all)).input, expected)
      else {
        const named = Object.fromEntries(all.map((source, i) => ["public-" + i, source]))
        const retained = Object.fromEntries(Object.entries(named).filter(([, source]) => sources.includes(source)))
        assert.deepEqual(options(Object.freeze(named)).input, retained)
      }
    }
  })
})

for (const shape of ["array", "map"]) {
  test("Alchemy entry globs: a real Rolldown build omits sidecar chunks from " + shape + " inputs", async () => {
    const root = mkdtempSync(join(tmpdir(), "alchemy-entry-sidecars-"))
    let bundle
    try {
      mkdirSync(join(root, "node_modules"))
      for (const [name, target] of [
        ["vibelang", join(repo, "packages/compiler")],
        ["vibelang-runtime", join(repo, "packages/runtime")],
        ["effect", resolve(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")]
      ]) symlinkSync(target, join(root, "node_modules", name))
      writeFileSync(join(root, "package.json"), '{"type":"module","private":true}')
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] },
        files: ["entry.vibe", "ordinary.ts"]
      }))
      writeFileSync(join(root, "entry.vibe"), "export const value: number = 42\n")
      writeFileSync(join(root, "ordinary.ts"), 'export const text = "kept"\n')
      writeFileSync(join(root, "entry.d.vibe.ts"), "export declare const value: number\n")
      const sources = ["entry.vibe", "ordinary.ts"].map(name => join(root, name))
      const expanded = [...sources, join(root, "entry.d.vibe.ts")]
      const input = shape === "array" ? expanded : Object.fromEntries(expanded.map((source, i) => ["public-" + i, source]))
      const { rolldown } = await import("rolldown")
      bundle = await rolldown({ input, cwd: root, platform: "node", plugins: [plugin({ root })] })
      const result = await bundle.generate({ format: "esm" })
      const chunks = result.output.filter(item => item.type === "chunk")
      assert.deepEqual(chunks.map(chunk => chunk.facadeModuleId).sort(), sources.slice().sort(), "each selected source emits exactly one entry chunk")
      const modules = await Promise.all(chunks.map(chunk => import("data:text/javascript;base64," + Buffer.from(chunk.code).toString("base64"))))
      assert.ok(modules.some(module => module.value === 42))
      assert.ok(modules.some(module => module.text === "kept"))
      if (shape === "map") assert.deepEqual(chunks.map(chunk => chunk.name).sort(), ["public-0", "public-1"])
    } finally {
      await bundle?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
}
