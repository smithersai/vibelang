import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { captureSourceSnippets, refreshSourceSnippets } from "../lib/source-snippets.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const fence = String.fromCharCode(96).repeat(3)
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-renamed-source-snippets.json", import.meta.url), "utf8"))
const document = (source, fragment = "", eol = "\n", file = "plugin.ts") => ("Guide\n\n<!-- source: " + file + fragment + " -->\n\n" + fence + "ts\n" + source + fence + "\n").replaceAll("\n", eol)
function probe({ fragment = "", eol = "\n", n = 1, rename = true, concurrent = false } = {}) {
 const root = mkdtempSync(join(tmpdir(), "renamed-source-snippet-"))
 try {
  const before = 'export const builtins = ["native"]\n', after = 'export const builtins = ["vibe' + n + '"]\n'
  writeFileSync(join(root, "plugin.ts"), before)
  const doc = document(before, fragment, eol)
  writeFileSync(join(root, "README.md"), doc)
  const snapshot = captureSourceSnippets(root, ["README.md", "plugin.ts"], { ts, named: true })
  if (rename) renameSync(join(root, "plugin.ts"), join(root, "plugin.vibe"))
  writeFileSync(join(root, rename ? "plugin.vibe" : "plugin.ts"), after)
  if (concurrent) writeFileSync(join(root, "README.md"), "Concurrent prose\n" + doc)
  const result = refreshSourceSnippets(root, snapshot, { ts, renames: rename ? [{ from: "plugin.ts", to: "plugin.vibe" }] : [] })
  const actual = readFileSync(join(root, "README.md"), "utf8")
  if (concurrent) {
   assert.equal(actual, "Concurrent prose\n" + doc)
   assert.equal(result.changed.length, 0)
   assert.equal(result.warnings.length, 1)
  } else {
   assert.equal(actual, document(after, fragment, eol, rename ? "plugin.vibe" : "plugin.ts").replace(fence + "ts", fence + (rename ? "vibe" : "ts")))
   assert.deepEqual(result.changed, ["README.md"])
  }
 } finally { rmSync(root, { recursive: true, force: true }) }
}
test("source-linked whole files follow a recorded rename and source rewrite", () => probe())
test("source-linked named fragments follow their source rename", () => probe({ fragment: "#builtins" }))
test("a named fragment follows routing without renaming its source", () => probe({ fragment: "#builtins", rename: false }))
test("a concurrently edited guide stays intact", () => probe({ concurrent: true }))
test("property: source-linked code and paths follow recorded renames with either line ending", () => {
 assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
 fc.assert(fc.property(fc.nat(1000), fc.boolean(), fc.boolean(), (n, crlf, fragment) => probe({ n, eol: crlf ? "\r\n" : "\n", fragment: fragment ? "#builtins" : "" })), { numRuns: 40, seed: 119026 })
})


test("the conversion transaction records its source-linked guide edits", async () => {
 const { prepareState, applyState } = await import("../lib/codemod-state.mjs")
 const root = mkdtempSync(join(tmpdir(), "snippet-transaction-"))
 try {
  const source = "export const builtins = 1\n"
  writeFileSync(join(root, "plugin.ts"), source)
  writeFileSync(join(root, "README.md"), document(source))
  const catalog = ["plugin.ts", "README.md"]
  const state = prepareState(root, ["plugin.ts"], ["plugin.ts"], { ts, catalog, tracked: catalog })
  applyState(root, state)
  assert.match(readFileSync(join(root, "README.md"), "utf8"), /source: plugin\.vibe/)
  assert.ok(state.packingFiles.includes("README.md"))
 } finally { rmSync(root, { recursive: true, force: true }) }
})

test("source-linked guides return to TypeScript when a module reverts", () => {
 const root = mkdtempSync(join(tmpdir(), "snippet-revert-"))
 try {
  const source = "export const builtins = 1\n"
  writeFileSync(join(root, "plugin.vibe"), source)
  writeFileSync(join(root, "README.md"), document(source, "", "\n", "plugin.vibe").replace(fence + "ts", fence + "vibe"))
  const snapshot = captureSourceSnippets(root, ["plugin.vibe", "README.md"], { ts, named: true })
  renameSync(join(root, "plugin.vibe"), join(root, "plugin.ts"))
  refreshSourceSnippets(root, snapshot, { renames: [{ from: "plugin.vibe", to: "plugin.ts" }] })
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), document(source))
 } finally { rmSync(root, { recursive: true, force: true }) }
})
