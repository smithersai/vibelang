// opencode:loader-records:later-export-routing-invalidates. The emit step
// (emitMigratedJs) emits and routes every migrated package, then writes each
// package's loader record, then checks every record against the final tree.
// A record names the package.json of each package its compile read, so a
// record written before a later package's routing rewrote that manifest
// missed on every cold start.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { emitMigratedJs } from "../lib/steps.mjs"
import { loaderRecord, loaderRecordFile } from "../../../../packages/compiler/cache.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const skip = !compiler && "set VIBELANG_BINARY"
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const typescript = dirname(require.resolve("typescript/package.json"))
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

// A workspace whose packages resolve each other, vibelang/project, TypeScript
// and the runtime through the root node_modules, with each package's
// node_modules/.bin/vibelang the compiler (compilerOf an unstaged run).
function workspace(t, files, packages) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "migrate-record-order-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, files)
  const modules = join(root, "node_modules")
  mkdirSync(modules, { recursive: true })
  symlinkSync(join(repo, "packages/compiler"), join(modules, "vibelang"))
  symlinkSync(join(repo, "packages/runtime"), join(modules, "vibelang-runtime"))
  symlinkSync(typescript, join(modules, "typescript"))
  symlinkSync(realpathSync(effect), join(modules, "effect"))
  for (const dir of packages) {
    const name = JSON.parse(files[`${dir}/package.json`]).name
    mkdirSync(dirname(join(modules, name)), { recursive: true })
    symlinkSync(join(root, dir), join(modules, name))
    mkdirSync(join(root, dir, "node_modules/.bin"), { recursive: true })
    symlinkSync(compiler, join(root, dir, "node_modules/.bin/vibelang"))
  }
  return root
}

// Runs the emit step over packages in order and returns, per package, how a
// cold lookup of its committed record fares against the final tree.
async function emitAndLookUp(t, files, order) {
  const root = workspace(t, files, order)
  const config = { target: root, toolchain: { kind: "installed" }, packages: order.map((dir) => ({ dir, tsconfig: "tsconfig.json" })) }
  const logs = join(root, ".logs")
  mkdirSync(logs, { recursive: true })
  const emitted = await emitMigratedJs(config, root, logs)
  return order.map((dir) => {
    const project = join(root, dir, "tsconfig.json")
    const receipt = emitted.find((entry) => entry.package === dir)
    const exports = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).exports
    let found
    try { readFileSync(loaderRecordFile(project)); found = loaderRecord({ project, root: dirname(project), compiler }).lookup() } catch { found = { miss: "no record" } }
    return { dir, exports, receipt: receipt?.loaderRecords, miss: found.miss }
  })
}

const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-loader-record-routing-order.json", import.meta.url), "utf8"))

for (const order of [corpus.packages, [...corpus.packages].reverse()]) {
  test(`opencode-loader-record-routing-order: every record holds in the final tree, packages in order ${order.join(", ")}`, { skip }, async (t) => {
    const results = await emitAndLookUp(t, corpus.files, order)
    for (const result of results) {
      assert.equal(result.exports["."].default, "./.vibelang/js/src/index.js", JSON.stringify(result))
      assert.equal(result.miss, undefined, JSON.stringify(result))
      assert.equal(result.receipt.length, 1, JSON.stringify(result))
      assert.equal(result.receipt[0].miss, undefined, JSON.stringify(result))
      assert.ok(result.receipt[0].file.endsWith(".vibelang/js/.loader/tsconfig.json.json"), JSON.stringify(result))
    }
  })
}

// Three packages in any order, each a native barrel over a native module and
// a .vibe leaf, the leaf importing any of the other packages' barrels: chains,
// diamonds and cycles.
function generated(edges) {
  const files = { "package.json": JSON.stringify({ name: "demo", private: true, type: "module", workspaces: ["packages/*"] }) }
  const tsconfig = corpus.files["packages/ai/tsconfig.json"]
  for (let k = 0; k < 3; k++) {
    const deps = edges[k].filter((j) => j !== k)
    files[`packages/p${k}/package.json`] = JSON.stringify({ name: `@demo/p${k}`, type: "module", exports: { ".": "./src/index.ts" } })
    files[`packages/p${k}/tsconfig.json`] = tsconfig
    files[`packages/p${k}/src/index.ts`] = `export { base${k} } from "./base.ts"\nexport { leaf${k} } from "./leaf.vibe"\n`
    files[`packages/p${k}/src/base.ts`] = `export const base${k}: number = ${k}\n`
    files[`packages/p${k}/src/leaf.vibe`] = deps.map((j) => `import { base${j} } from "@demo/p${j}"\n`).join("") +
      `\nexport const leaf${k}: number = ${[String(k), ...deps.map((j) => `base${j}`)].join(" + ")}\n`
  }
  return files
}

test("loader-record-order: records hold for any package order and import graph among three packages", { skip }, async (t) => {
  const edges = fc.tuple(...[0, 1, 2].map(() => fc.subarray([0, 1, 2])))
  const order = fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 })
  await fc.assert(fc.asyncProperty(edges, order, async (graph, sequence) => {
    const results = await emitAndLookUp(t, generated(graph), sequence.map((k) => `packages/p${k}`))
    for (const result of results) {
      assert.equal(result.miss, undefined, JSON.stringify({ graph, sequence, result }))
      assert.equal(result.receipt[0]?.miss, undefined, JSON.stringify({ graph, sequence, result }))
    }
  }), { seed: 2026110221, numRuns: 5 })
})
