import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeBundledImports } from "../lib/bundled-imports.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const ts = loadTypeScript([join(repo, "packages/compiler/test/eslint"), join(repo, ".smithers")])
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-routed-sidecar-layouts.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

function routed(layout) {
  const root = mkdtempSync(join(tmpdir(), "routed-sidecar-layouts-"))
  const dir = "packages/client", source = dir + "/src/effect/rpc.vibe"
  try {
    put(root, dir + "/package.json", JSON.stringify({ name: "@demo/client", type: "module" }, null, 2) + "\n")
    put(root, dir + "/src/index.ts", corpus.importer)
    put(root, source, corpus.module)
    put(root, dir + "/.vibelang/js/src/effect/rpc.js", corpus.module)
    put(root, dir + "/" + layout, "export declare const rpc = 1\n")
    routeBundledImports({ root, packages: [{ dir, sources: ["src"] }], ts, bundled: new Set([source]) })
    return JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")).imports["#vibelang/emitted/src/effect/rpc"].types
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a route names the sidecar the compiler wrote, for every project root", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  for (const layout of corpus.layouts) assert.equal(routed(layout), "./" + layout)
})

test("property: the type condition always resolves to an existing declaration", () => {
  fc.assert(fc.property(fc.constantFrom(...corpus.layouts), layout => assert.equal(routed(layout), "./" + layout)), { numRuns: 12, seed: 272731 })
})
