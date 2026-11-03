import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { foreignChanges } from "../lib/touched.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-package-script-scope.json", import.meta.url)))

test("t3code: only recorded package-script replacements enter batch scope", () => {
  fc.assert(fc.property(fc.constantFrom("", "./", '"', "'"), fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/), (prefix, name) => {
    const quote = prefix === '"' || prefix === "'" ? prefix : ""
    const path = (quote ? "" : prefix) + "scripts/" + name
    const manifest = corpus.manifest, module = "infra/relay/scripts/" + name + ".vibe"
    const command = "node " + quote + path + ".ts" + quote
    const before = { name: "relay", scripts: { [corpus.script]: command, test: "vitest" } }
    const after = { ...before, scripts: { ...before.scripts, [corpus.script]: command.replace(".ts", ".vibe") } }
    const batch = { files: [{ planned: module.replace(".vibe", ".ts"), path: module, migrated: true }],
      codemod: { packageScriptEdits: [{ manifest, script: corpus.script, module }] },
      manifestSnapshots: { [manifest]: { before: JSON.stringify(before), after: JSON.stringify(after, null, 2) } } }
    const changed = [{ status: "M", path: manifest }]
    assert.deepEqual(foreignChanges(changed, batch), [])
    assert.deepEqual(foreignChanges(changed, { ...batch, codemod: {} }), changed)
    assert.deepEqual(foreignChanges(changed, { ...batch, manifestSnapshots: {} }), changed)
    for (const bad of [
      { ...after, private: true },
      { ...after, scripts: { ...after.scripts, test: "true" } },
      { ...after, scripts: { ...after.scripts, [corpus.script]: after.scripts[corpus.script] + " --skip-tests" } }
    ]) {
      assert.deepEqual(foreignChanges(changed, { ...batch, manifestSnapshots: { [manifest]: { before: JSON.stringify(before), after: JSON.stringify(bad) } } }), changed)
    }
    // Revert keeps historical receipts but authorizes no rewrite for that module.
    const oldModule = "infra/relay/scripts/reverted.vibe"
    const withRevert = {
      ...batch,
      files: [...batch.files, { planned: oldModule.replace(".vibe", ".ts"), path: oldModule.replace(".vibe", ".ts"), migrated: false }],
      codemod: { packageScriptEdits: [...batch.codemod.packageScriptEdits, { manifest, script: "old", module: oldModule }] },
      manifestSnapshots: { [manifest]: {
        before: JSON.stringify({ ...before, scripts: { ...before.scripts, old: "node scripts/reverted.ts" } }),
        after: JSON.stringify({ ...after, scripts: { ...after.scripts, old: "node scripts/reverted.ts" } })
      } }
    }
    assert.deepEqual(foreignChanges(changed, withRevert), [])
    const unauthorized = JSON.parse(withRevert.manifestSnapshots[manifest].after)
    unauthorized.scripts.old = "node scripts/reverted.vibe"
    withRevert.manifestSnapshots[manifest].after = JSON.stringify(unauthorized)
    assert.deepEqual(foreignChanges(changed, withRevert), changed)
    const foreign = [{ status: "M", path: "infra/other/package.json" }]
    assert.deepEqual(foreignChanges([...changed, ...foreign], batch), foreign)
  }), { seed: 31105, numRuns: 150 })
})
