import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { checkConvertedPaths } from "../lib/converted-paths.mjs"
import { restoreSourceLiterals } from "../lib/source-paths.mjs"
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

test("SSR entry URLs follow only their owned package rename and retain exact revert receipts", () => {
  fc.assert(fc.property(
    variant, extension, fc.constantFrom("before", "after"), fc.constantFrom("serverEntry", "clientEntry"),
    fc.constantFrom("'", '"', String.fromCharCode(96)), fc.constantFrom(".ts", ".mts"), fc.boolean(), fc.boolean(),
    (word, configExt, form, key, quote, sourceExt, quotedKey, converted) => {
      const dir = "examples/app-" + word
      const config = dir + "/" + (form === "before" ? "vite." + word + ".config" : "vite.config." + word) + configExt
      const oldURL = "/src/entry" + sourceExt, newURL = "/src/entry.vibe"
      const source = "export default defineConfig({ plugins: [foldkit({ ssr: { " +
        (quotedKey ? JSON.stringify(key) : key) + ": " + quote + oldURL + quote + " } })] })\n"
      const from = dir + oldURL, to = dir + newURL
      const files = {
        [dir + "/package.json"]: JSON.stringify({ name: "app-" + word, version: "1.0.0" }),
        [config]: source,
        [converted ? to : from]: "export const entry = 1\n",
        "examples/other/package.json": JSON.stringify({ name: "other", version: "1.0.0" }),
        ["examples/other" + newURL]: "export const entry = 2\n",
      }
      tree(files, root => {
        const catalog = ["package.json", ...Object.keys(files)]
        const read = file => readFileSync(join(root, file), "utf8")
        const before = checkConvertedPaths({ ts, tracked: catalog, read })
        assert.equal(before.refusals.some(r => r.file === config && r.module === from), converted, "stale root URL must be refused before wiring")
        const renames = converted ? [{ from, to }] : []
        const receipt = prepareReferences(root, renames, ts, ownedToolConfigs(root, catalog), catalog)
        assert.equal(receipt.referenceEdits.length, converted ? 1 : 0)
        assert.deepEqual(receipt.referenceWarnings, [])
        for (const write of receipt.referenceWrites) writeFileSync(join(root, write.file), write.after)
        const after = read(config)
        assert.equal(after, converted ? source.replace(oldURL, newURL) : source)
        assert.equal(checkConvertedPaths({ ts, tracked: catalog, read }).ok, true)
        if (converted) {
          assert.equal(receipt.referenceEdits[0].module, to)
          assert.equal(receipt.referenceEdits[0].kind, "source-reference")
          assert.equal(restoreSourceLiterals(ts, root, receipt.referenceEdits, from, renames).length, 1)
          assert.equal(read(config), source, "revert preserves quotes and every original byte")
        }
      })
    },
  ), { seed: 157158, numRuns: 80 })
})

test("SSR URL wiring preserves filesystem paths and refuses unsafe suffixes", () => {
  const dir = "examples/ssr", from = dir + "/src/entry.ts", to = dir + "/src/entry.vibe"
  const cases = [
    ["unrelated absolute data", "vite.config.ts", 'export const path = "/src/entry.ts"\n', false],
    ["other config", "tool.config.ts", 'export default { ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["outside ssr", "vite.config.ts", 'export default { serverEntry: "/src/entry.ts" }\n', false],
    ["explicit root", "vite.config.ts", 'export default { root: "web", ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["dynamic root", "vite.config.ts", 'export default { root: getRoot(), ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["spread root", "vite.config.ts", 'export default { ...base, ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["shorthand root", "vite.config.ts", 'const root = "web"; export default { root, ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["accessor root", "vite.config.ts", 'export default { get root() { return "web" }, ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["computed root", "vite.config.ts", 'export default { ["root"]: "web", ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["dynamic key", "vite.config.ts", 'export default { [getKey()]: "web", ssr: { serverEntry: "/src/entry.ts" } }\n', false],
    ["protocol URL", "vite.config.ts", 'export default { ssr: { serverEntry: "//examples/ssr/src/entry.ts" } }\n', false],
    ["escape root", "vite.config.ts", 'export default { ssr: { serverEntry: "/../examples/ssr/src/entry.ts" } }\n', false],
    ["remote URL", "vite.config.ts", 'export default { ssr: { serverEntry: "https://example.com/src/entry.ts" } }\n', false],
    ["query", "vite.config.ts", 'export default { ssr: { serverEntry: "/src/entry.ts?raw" } }\n', true],
    ["fragment", "vite.config.ts", 'export default { ssr: { clientEntry: "/src/entry.ts#entry" } }\n', true],
  ]
  for (const [name, filename, text, refused] of cases) {
    const file = dir + "/" + filename
    tree({ [dir + "/package.json"]: '{"name":"ssr","version":"1.0.0"}', [file]: text, [to]: "export {}\n" }, root => {
      const catalog = ["package.json", dir + "/package.json", file, to]
      const read = path => readFileSync(join(root, path), "utf8")
      const receipt = prepareReferences(root, [{ from, to }], ts, [file], catalog)
      assert.deepEqual(receipt.referenceEdits, [], name)
      assert.deepEqual(receipt.referenceWrites, [], name)
      const result = checkConvertedPaths({ ts, tracked: catalog, read })
      assert.equal(result.refusals.some(r => r.kind === "static-suffix"), refused, name)
    })
  }
})
