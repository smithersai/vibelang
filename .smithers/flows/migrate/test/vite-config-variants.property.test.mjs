import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { prepareReferences } from "../lib/codemod-state.mjs"
import { ownedToolConfigs } from "../lib/tool-config-references.mjs"
import { addVitePlugin, viteAppConfigs } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-playground-vite-config.json", import.meta.url), "utf8"))

function tree(files, body) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-variant-"))
  files = { "package.json": JSON.stringify({ private: true, workspaces: ["a", "examples/*"] }), ...files }
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    return body(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit-157: setup wires vite.config.playground.ts and the codemod follows its serverEntry", () => {
  const files = {
    "examples/ssr/package.json": JSON.stringify({ name: "ssr" }),
    "examples/ssr/vite.config.ts": corpus.config,
    "examples/ssr/vite.config.playground.ts": corpus.config,
    "examples/ssr/src/entry.server.vibe": "export const entry = 1\n",
  }
  tree(files, (root) => {
    const configs = viteAppConfigs(root, ["examples/ssr"])
    assert.deepEqual(configs.sort(), ["examples/ssr/vite.config.playground.ts", "examples/ssr/vite.config.ts"])
    const scanned = ownedToolConfigs(root, Object.keys(files))
    assert.ok(scanned.includes("examples/ssr/vite.config.playground.ts"))
    const result = prepareReferences(root, [{ from: "examples/ssr/src/entry.server.ts", to: "examples/ssr/src/entry.server.vibe" }], ts, scanned, Object.keys(files))
    assert.ok(result.referenceEdits.some((edit) => edit.file === "examples/ssr/vite.config.playground.ts" && edit.to === "/src/entry.server.vibe"), JSON.stringify(result.referenceEdits))
    assert.match(addVitePlugin(corpus.config, ts), /vibelang\(\)/)
  })
})

const variant = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/).filter((word) => !["d", "test", "spec"].includes(word))
const extension = fc.constantFrom(".ts", ".mts", ".js", ".mjs")

test("every config a build can load is found, in either named form", () => {
  fc.assert(fc.property(variant, extension, fc.constantFrom("before", "after"), (word, ext, form) => {
    const file = form === "before" ? `vite.${word}.config${ext}` : `vite.config.${word}${ext}`
    tree({ "a/package.json": JSON.stringify({ name: "a" }), ["a/" + file]: "export default {}\n", "a/src/m.vibe": "export const m = 1\n" }, (root) => {
      assert.deepEqual(viteAppConfigs(root, ["a"]), ["a/" + file])
      assert.deepEqual(ownedToolConfigs(root, ["a/" + file]), ["a/" + file])
    })
  }), { seed: 157157, numRuns: 60 })
})

test("declarations, tests and non-configs are not build configs", () => {
  const notConfigs = ["vite.config.d.ts", "vite.config.test.ts", "vite.config.spec.ts", "vite.config.playground.d.ts", "vite.configuration.ts", "myvite.config.playground.ts", "vite.config.a.b.ts"]
  const files = { "a/package.json": JSON.stringify({ name: "a" }), "a/src/m.vibe": "export const m = 1\n" }
  for (const file of notConfigs) files["a/" + file] = "export default {}\n"
  tree(files, (root) => assert.deepEqual(viteAppConfigs(root, ["a"]), []))
  tree(files, (root) => {
    for (const file of ["vite.config.d.ts", "vite.config.test.ts", "vite.config.spec.ts", "vite.configuration.ts"]) assert.deepEqual(ownedToolConfigs(root, ["a/" + file]), [], file)
  })
})

test("a test runner's config stays out of the reference scan, in the variant form too", () => {
  tree({ "a/vitest.config.ci.ts": "export default {}\n", "a/playwright.config.ci.ts": "export default {}\n" }, (root) =>
    assert.deepEqual(ownedToolConfigs(root, ["a/vitest.config.ci.ts", "a/playwright.config.ci.ts"]), []))
})
