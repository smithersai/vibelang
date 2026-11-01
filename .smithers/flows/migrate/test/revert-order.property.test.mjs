import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, posix } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { renameBatch, restoreSpecifiers, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-revert-importer-order.json", import.meta.url)))
const rule = "Reverting an importer and its dependency restores their original TypeScript specifiers in either order."
function put(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}
test("foldkit-45: real revert preserves published import spelling in both orders", async () => {
  for (const order of corpus.orders) {
    const root = mkdtempSync(join(tmpdir(), "foldkit-revert-order-"))
    const target = join(root, "target"), run = join(root, "run")
    try {
      put(target, { "package.json": "{}", ...corpus.files })
      await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
      await Jj.commit(target, "original declarations")
      writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
      const files = Object.keys(corpus.files)
      writeJson(paths(run).plan, { batches: [{ files }] })
      const renamed = renameBatch(target, files).map(r => r.to)
      writeJson(paths(run).codemod("01"), { importEdits: rewriteImports(target, renamed) })
      for (const file of order) await revert({ run, batch: "01", file: file.replace(/\.ts$/, ".vibe"), reason: "test" })
      for (const [file, text] of Object.entries(corpus.files)) assert.equal(readFileSync(join(target, file), "utf8"), text)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
test("revert order preserves original imports, exports and import types across a dependency graph", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(rule))
  const orders = [[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]]
  fc.assert(fc.property(
    fc.constantFrom("src", "nested/src", "with space", "café"),
    fc.array(fc.constantFrom(".js", ".ts", ""), { minLength: 3, maxLength: 3 }),
    fc.constantFrom("'", '"'),
    fc.constantFrom("\n", "\r\n"),
    fc.constantFrom(...orders),
    (dir, ext, quote, nl, order) => {
      const root = mkdtempSync(join(tmpdir(), "foldkit-revert-property-"))
      try {
        const files = [0,1,2].map(i => dir + "/module" + i + ".ts")
        const spec = (n, x) => quote + "./module" + n + x + quote
        const originals = {
          [files[0]]: "import type { B } from " + spec(1, ext[0]) + nl + "export type A = B" + nl,
          [files[1]]: "export type { C as B } from " + spec(2, ext[1]) + nl,
          [files[2]]: "export type C = { value: string }" + nl,
          [dir + "/consumer.ts"]: "export type Consumer = import(" + spec(0, ext[2]) + ").A" + nl
        }
        put(root, originals)
        const scope = renameBatch(root, files).map(r => r.to).concat(dir + "/consumer.ts")
        const edits = rewriteImports(root, scope)
        for (const index of order) {
          const file = files[index], vibe = file.replace(/\.ts$/, ".vibe")
          rmSync(join(root, vibe))
          writeFileSync(join(root, file), originals[file])
          scope[scope.indexOf(vibe)] = file
          restoreSpecifiers(root, edits, file)
          rewriteImports(root, scope, [file])
        }
        for (const [file, text] of Object.entries(originals)) assert.equal(readFileSync(join(root, file), "utf8"), text)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }), { seed: 450045, numRuns: 200 })
})
test("saved edits restore an existing Vibe consumer; ambiguous restored native paths are not guessed", () => {
  const root = mkdtempSync(join(tmpdir(), "foldkit-revert-native-"))
  try {
    const native = 'import { b } from "./b.vibe"\n'
    put(root, { "a.vibe": native, "a.ts": native, "a.mts": native, "b.ts": "export const b = 1\n" })
    const edits = [{ file: "a.vibe", from: "./b.js", to: "./b.vibe" }]
    assert.deepEqual(restoreSpecifiers(root, edits, "b.ts"), [{ file: "a.vibe", from: "./b.vibe", to: "./b.js" }])
    assert.equal(readFileSync(join(root, "a.vibe"), "utf8"), native.replace("./b.vibe", "./b.js"))
    rmSync(join(root, "a.vibe"))
    assert.deepEqual(restoreSpecifiers(root, edits, "b.ts"), [])
    assert.equal(readFileSync(join(root, "a.ts"), "utf8"), native)
    assert.ok(existsSync(join(root, "a.mts")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
