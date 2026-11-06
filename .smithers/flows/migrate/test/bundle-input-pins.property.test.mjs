import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathReadDeferrals } from "../lib/references.mjs"
import { pinnedBundleInputs } from "../lib/test-bundles.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-bundle-input-pins.json", import.meta.url), "utf8"))

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "bundle-input-pins-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

const manifests = { "packages/core/package.json": '{"name":"@test/core"}\n', "packages/cli/package.json": '{"name":"@test/cli"}\n', "package.json": '{"private":true,"workspaces":["packages/*"]}\n' }
const modules = Object.keys(corpus.sources)
const everything = [...modules, ...Object.keys(corpus.readers), ...Object.keys(manifests)]

test("an input assertion pins what it names and the imports between, and frees the rest of its package", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  const root = repository({ ...corpus.sources, ...corpus.readers, ...manifests })
  try {
    const held = pathReadDeferrals(root, modules, everything, { pinned: pinnedBundleInputs(root) })
    assert.deepEqual(held.map(item => item.file).sort(), [
      "packages/cli/src/commands/run.ts", "packages/cli/src/run/run.ts", "packages/cli/src/util/error.ts",
      "packages/cli/src/util/middle.ts", "packages/core/src/mcp/index.ts"])
    for (const item of held) assert.match(item.reason, /BUNDLE-INPUT-PATHS/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("without routing the whole package stays native", () => {
  const root = repository({ ...corpus.sources, ...corpus.readers, ...manifests })
  try {
    assert.deepEqual(pathReadDeferrals(root, modules, everything).map(item => item.file).sort(), [...modules].sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: a chain pins exactly the modules between its two named ends", () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 }), (length, a, b) => {
    const first = Math.min(a, b) % length, last = Math.max(a, b) % length
    const name = i => `packages/core/src/m${i}.ts`
    const sources = Object.fromEntries(Array.from({ length }, (_, i) => [name(i), i + 1 < length ? `export * from "./m${i + 1}.ts"\n` : "export const value = 1\n"]))
    const root = repository({ ...sources, "packages/core/package.json": manifests["packages/core/package.json"], "package.json": manifests["package.json"] })
    try {
      const pinned = pinnedBundleInputs(root)(new Set([name(first), name(last)]))
      const expected = Array.from({ length }, (_, i) => i).filter(i => i >= Math.min(first, last) && i <= Math.max(first, last)).map(name)
      assert.deepEqual([...pinned].sort(), expected.sort())
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 30, seed: 272730 })
})
