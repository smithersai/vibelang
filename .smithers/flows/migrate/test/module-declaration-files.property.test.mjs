import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { moduleDeclarationFiles } from "../lib/module-declaration-files.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-throwing-declaration.json", import.meta.url)))

test("the reverted source owns its throwing body declaration in both layouts", () => {
  assert.deepEqual(moduleDeclarationFiles(ts, corpus.file, corpus.source, corpus.sidecar), corpus.outputs)
})

test("body declaration cleanup follows parsed names and preserves unrelated declarations", () => {
  fc.assert(fc.property(
    fc.constantFrom("throwing", "parse", "Text", "Über", "$call$ts", "café"),
    fc.constantFrom("src", "src/deep", "with space", "café"),
    fc.boolean(),
    (name, directory, relocated) => {
      const file = directory + "/main.vibe"
      const sidecar = relocated ? ".vibe/declarations/" + directory + "/main.d.vibe.ts" : undefined
      const source = '// module decoy {}\nconst text = "module another {}";\nnamespace namespaced {}\ndeclare module ambient {}\nmodule ' + name + ' {export const n = 1}\n'
      const encoded = [...name].map(c => /^[a-z0-9_]$/.test(c) ? c : "-" + c.codePointAt(0).toString(16) + "-").join("")
      const outputs = moduleDeclarationFiles(ts, file, source, sidecar)
      assert.ok(outputs.includes(directory + "/main.vibe." + encoded + ".d.ts"))
      assert.equal(outputs.length, relocated ? 2 : 1)
      assert.ok(outputs.every(file => !file.includes(".decoy.") && !file.includes(".another.")))
    }), { seed: 483740, numRuns: 100 })
})
