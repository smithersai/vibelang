import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathAliases, rewriteImports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-revert-unrecorded-specifier.json", import.meta.url), "utf8"))

function revert({ allowsSource, jsx }) {
  const root = mkdtempSync(join(tmpdir(), "revert-unrecorded-specifier-"))
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  try {
    const extension = jsx ? ".tsx" : ".ts", vibe = jsx ? ".vibex" : ".vibe"
    put("tsconfig.json", JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", jsx: "preserve",
      ...(allowsSource ? { allowImportingTsExtensions: true, noEmit: true } : {}) }, include: ["src"] }))
    const importer = "src/effect.ts", module = "src/route/client" + extension
    put(importer, corpus.importer.replace(".vibe", vibe))
    put(module, corpus.module)
    rewriteImports(root, [importer, module], [module], pathAliases(ts, root))
    return readFileSync(join(root, importer), "utf8")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a revert spells an unrecorded .vibe import by the project's emission policy", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  assert.equal(revert({ allowsSource: false, jsx: false }), corpus.importer.replace("client.vibe", "client.js"))
  assert.equal(revert({ allowsSource: false, jsx: true }), corpus.importer.replace("client.vibe", "client.jsx"))
  assert.equal(revert({ allowsSource: true, jsx: false }), corpus.importer.replace("client.vibe", "client.ts"))
})

test("property: the spelling follows the project and the module kind, never a rejected source name", () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), (allowsSource, jsx) => {
    const name = /"\.\/route\/client(\.\w+)"/.exec(revert({ allowsSource, jsx }))[1]
    assert.equal(name, allowsSource ? (jsx ? ".tsx" : ".ts") : (jsx ? ".jsx" : ".js"))
  }), { numRuns: 12, seed: 272728 })
})
