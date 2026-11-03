import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { compileProjectSync, projectBackend, writeLoaderRecord } from "../project.mjs"
import { loaderScope } from "../loader-scope.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const rule = "ordinary module emission, host rules and incompatible-option diagnostics still apply."

test("project diagnostics oracle quotes the language specification", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(rule))
})

async function check({ count, nested, async, record, bad = true, warning = false }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-project-diagnostics-"))
  let backend
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(root, "node_modules/effect"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "main.vibe"), "export const answer = 42\n")
    const native = nested ? "src/native" : "native"
    mkdirSync(join(root, native), { recursive: true })
    const files = Array.from({ length: count }, (_, i) => `${native}/bad${i}.ts`)
    for (const file of files) writeFileSync(join(root, file),
      `export const n: number = ${bad ? '"bad"' : '42'}\n` +
      (warning ? 'import { Effect } from "effect"\nexport const pause = () => Effect.sleep(0)\n' : ''))
    const project = join(root, "tsconfig.json")
    writeFileSync(project, JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true }, files: ["main.vibe", ...files], vibe: { effectGlobals: false, effectModules: false, severities: { EK3833: "warning" } } }))
    // A clean loader result, whether cached or recorded, must never hide the
    // native errors from a subsequent public project check.
    const trace = []
    const options = { root, project, compiler, debug: line => trace.push(line), cache: { directory: join(root, ".cache") } }
    const loaded = compileProjectSync({ ...options, [loaderScope]: true })
    assert.deepEqual(loaded.errors, [])
    if (record) {
      await new Promise(resolve => setTimeout(resolve, 150))
      assert.equal(writeLoaderRecord(options).modules, 1)
      rmSync(join(root, ".cache"), { recursive: true, force: true })
    }
    trace.length = 0
    backend = projectBackend(options)
    for (let repeat = 0; repeat < 2; repeat++) {
      const result = async ? await backend.compile(project) : compileProjectSync(options)
      assert.deepEqual(result.errors.filter(d => d.code === "TS2322").map(d => d.file).sort(), (bad ? files : []).map(file => join(root, file)).sort())
      assert.deepEqual(result.warnings.filter(d => d.code === "EK3833").map(d => d.file).sort(), (warning ? files : []).map(file => join(root, file)).sort())
      assert.deepEqual([...result.outputs.keys()], [join(root, "main.vibe")])
    }
    if (!bad) assert.ok(trace.some(line => line.includes("from the cache")), trace.join("\n"))
    assert.deepEqual(compileProjectSync({ ...options, [loaderScope]: true }).warnings, [], "public warnings never enter the loader cache")
  } finally {
    await backend?.close()
    rmSync(root, { recursive: true, force: true })
  }
}

test("public project results include native errors after a loader cache or record hit", async () => {
  for (const async of [false, true]) for (const record of [false, true]) {
    await check({ count: 1, nested: false, async, record })
    await check({ count: 1, nested: true, async, record, bad: false, warning: true })
  }
})

test("property: native project diagnostics survive input shapes and loader reuse", async () => {
  await fc.assert(fc.asyncProperty(fc.record({ count: fc.integer({ min: 1, max: 3 }), nested: fc.boolean(), async: fc.boolean(), record: fc.boolean(), bad: fc.boolean(), warning: fc.boolean() }), check), { numRuns: 12, seed: 34007 })
})
