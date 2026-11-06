import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import fc from "fast-check"
import { rollup } from "rollup"
import { rolldown } from "rolldown"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { unplugin } from "../src/index.js"
import vibelangRollup from "../src/rollup.js"
import vibelangRolldown from "../src/rolldown.js"
import { fileHasVibeDirective, isVibeLangFile } from "../src/vibe-directive.js"

const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-virtual-worker-ids.json", import.meta.url)))
const frameworks = ["vite", "rollup", "rolldown", "webpack", "rspack", "esbuild"]
const hooks = frameworks.map(framework => [framework, unplugin.raw({}, { framework }).loadInclude])
const quote = "The compiler decides from the file's name and its bytes alone"

test("source directive coverage quotes the source file contract", () => {
  assert.ok(readFileSync(SpecPath("../vips/0042-vibelang-in-ts-files-open.md"), "utf8").includes(quote))
})

test("directive detection rejects virtual IDs before inspecting the filesystem", () => {
  for (const id of corpus.ids) {
    assert.equal(fileHasVibeDirective(id), false, JSON.stringify(id))
    assert.equal(isVibeLangFile(id), corpus.expected, JSON.stringify(id))
    for (const [framework, include] of hooks) assert.equal(include(id), false, framework + " " + JSON.stringify(id))
  }
})

test("generated virtual IDs remain outside every source load hook", () => {
  const letters = fc.array(fc.constantFrom("a", "Z", "0", "雪", " ", ".", "-", "_", "/", ":"), { maxLength: 48 }).map(x => x.join(""))
  fc.assert(fc.property(letters, letters,
    fc.constantFrom(".ts", ".tsx", ".mts", ".cts", ".vibe", ".vibex", ".d.ts", ".js"),
    fc.constantFrom("", "?import", "?worker", "?raw", "?file=Other.vibe"),
    (before, after, suffix, query) => {
      const file = "virtual:" + before + "\0" + after + suffix
      assert.equal(fileHasVibeDirective(file), false)
      assert.equal(isVibeLangFile(file), false)
      for (const [framework, include] of hooks) assert.equal(include(file + query), false, framework)
    }), { numRuns: 400, seed: 421931 })
})

test("real source files, queries and generated module outputs keep their owners", () => {
  const root = mkdtempSync(join(tmpdir(), "vibe-virtual-ids-"))
  try {
    const typed = join(root, "marked.ts"), plain = join(root, "plain.ts"), declaration = join(root, "types.d.ts"), native = join(root, "main.vibe")
    writeFileSync(typed, "// @vibe\nexport const value = 1\n")
    writeFileSync(plain, "export const value = 1\n")
    writeFileSync(declaration, "// @vibe\nexport declare const value: number\n")
    writeFileSync(native, "module host { export const value = 1 }\nexport const value = 1\n")
    assert.equal(fileHasVibeDirective(typed), true)
    assert.equal(fileHasVibeDirective(plain), false)
    assert.equal(fileHasVibeDirective(declaration), false)
    for (const [, include] of hooks) {
      assert.equal(include(typed + "?worker=\0virtual"), true)
      assert.equal(include(plain), false)
      assert.equal(include(declaration), false)
      assert.equal(include(native + "?import"), true)
      assert.equal(include(native + ".host.js"), true)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const [name, build, plugin] of [["rollup", rollup, vibelangRollup], ["rolldown", rolldown, vibelangRolldown]]) {
  test(name + " preserves another plugin's virtual TypeScript worker", async () => {
    const id = "\0virtual:worker-entry:entry.ts"
    const bundle = await build({
      input: "virtual:entry",
      plugins: [plugin(), {
        name: "virtual-worker-fixture",
        resolveId(source) { return source === "virtual:entry" ? id : null },
        load(source) { return source === id ? "export const answer = 42" : null }
      }]
    })
    try {
      const result = await bundle.generate({ format: "esm" })
      const chunk = result.output.find(x => x.type === "chunk")
      assert.ok(chunk)
      const module = await import("data:text/javascript," + encodeURIComponent(chunk.code))
      assert.equal(module.answer, 42)
    } finally {
      await bundle.close()
    }
  })
}
