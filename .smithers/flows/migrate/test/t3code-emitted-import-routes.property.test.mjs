import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { foreignChanges } from "../lib/touched.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-emitted-import-routes.json", import.meta.url)))

// Relay's one-pass verify: the codemod moved a script to its .vibe module and
// emission added #vibelang/emitted routes to the same manifest. The routes are
// the flow's output; every other manifest change still needs its own authority.
const manifest = corpus.manifest
const before = { name: "relay", private: true, type: "module", scripts: { [corpus.script]: corpus.before, test: "vitest" } }
const moved = { ...before, scripts: { ...before.scripts, [corpus.script]: corpus.before.replace(".ts", ".vibe") } }
const batch = after => ({
  files: [{ planned: corpus.module.replace(".vibe", ".ts"), path: corpus.module, migrated: true }],
  codemod: { packageScriptEdits: [{ manifest, script: corpus.script, module: corpus.module }] },
  manifestSnapshots: { [manifest]: { before: JSON.stringify(before, null, 2), after: JSON.stringify(after, null, 2) } }
})
const changed = [{ status: "M", path: manifest }]
const route = (path, extension = ".vibe", sidecar = "./" + path) => ({
  types: sidecar + ".d" + extension + ".ts", "vibelang-source": "./" + path + extension, default: "./.vibelang/js/" + path + ".js"
})

test("Relay: a script move with the emitter's import routes stays in batch scope", () => {
  assert.deepEqual(foreignChanges(changed, batch({ ...moved, imports: corpus.routes })), [])
  assert.deepEqual(foreignChanges(changed, batch(moved)), [])
})

test("an emitted route is in scope only when its key fixes its whole value", () => {
  const segment = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,8}$/)
  fc.assert(fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), fc.constantFrom(".vibe", ".vibex"), fc.boolean(), (parts, extension, declarations) => {
    const path = parts.join("/"), key = "#vibelang/emitted/" + path
    const good = route(path, extension, declarations ? "./.vibe/declarations/" + path : "./" + path)
    assert.deepEqual(foreignChanges(changed, batch({ ...moved, imports: { [key]: good } })), [])
    // A route an earlier batch wrote may stay, go, or be joined by authored imports only if they existed before.
    const prior = { ...before, imports: { [key]: good } }
    const kept = { ...batch({ ...moved, imports: { [key]: good } }), manifestSnapshots: { [manifest]: { before: JSON.stringify(prior), after: JSON.stringify({ ...moved, imports: { [key]: good } }) } } }
    assert.deepEqual(foreignChanges(changed, kept), [])
    for (const bad of [
      { ...good, default: "./dist/" + path + ".js" },
      { ...good, default: "./.vibelang/js/../" + path + ".js" },
      { ...good, "vibelang-source": "./" + path + "x.ts" },
      { ...good, "vibelang-source": "./other/" + path + extension },
      { ...good, types: "./" + path + ".d.ts" },
      { ...good, node: "./" + path + ".js" },
      "./" + path + extension
    ]) assert.deepEqual(foreignChanges(changed, batch({ ...moved, imports: { [key]: bad } })), changed, JSON.stringify(bad))
    for (const bad of [
      { ...moved, imports: { [key]: good, "#authored": "./src/a.js" } },
      { ...moved, imports: { [key]: good }, dependencies: { effect: "4.1.1" } },
      { ...moved, imports: { [key]: good }, private: false },
      { ...moved, imports: { [key]: good }, scripts: { ...moved.scripts, test: "true" } },
      { ...moved, imports: { [key.replace("#vibelang/emitted/", "#vibelang/other/")]: good } }
    ]) assert.deepEqual(foreignChanges(changed, batch(bad)), changed, JSON.stringify(bad))
  }), { seed: 31106, numRuns: 150 })
})

test("an emitted route does not hide a manifest edit without script authority", () => {
  const plain = { files: [], codemod: {}, manifestSnapshots: {} }
  assert.deepEqual(foreignChanges(changed, plain), changed)
  const authored = { ...before, imports: { "#config": "./src/config.js" } }
  const removed = { ...batch({ ...moved, imports: corpus.routes }), manifestSnapshots: { [manifest]: { before: JSON.stringify(authored), after: JSON.stringify({ ...moved, imports: corpus.routes }) } } }
  assert.deepEqual(foreignChanges(changed, removed), changed)
})
