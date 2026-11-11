import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareDeclarations } from "../lib/declarations.mjs"
const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")

export function compare(before, after, manifest) {
  const root = mkdtempSync(join(tmpdir(), "migrate-public-dts-"))
  try {
    for (const [dir, files] of Object.entries({ before, after })) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest))
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true })
        writeFileSync(join(root, dir, file), text)
      }
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}


const forms = [
  p => `export * from "${p}";\n`,
  p => `import type { Item as Inner } from "${p}"; export type Item = Inner;\n`,
  p => `export type Item = import("${p}").Item;\n`,
  p => `import type * as X from "${p}"; export type Item = X.Item;\n`,
  p => `export type Item = import("${p}").Item;\n`
]

export function check(edges, exposed, ext) {
const before = {}
for (let i = 0; i < edges.length; i++) before[`n${i}${ext}`] = i + 1 < edges.length
  ? forms[edges[i]](`./n${i + 1}${ext === ".d.mts" ? ".mjs" : ext === ".d.cts" ? ".cjs" : ".js"}`) : exposed ? forms[edges[i]](`./new${ext === ".d.mts" ? ".mjs" : ext === ".d.cts" ? ".cjs" : ".js"}`) : "export interface Item {}\n"
const result = compare(before, { ...before, [`new${ext}`]: "export interface Item {}\n" },
  { exports: { ".": { types: `./n0${ext}` } } })
assert.equal(result.identical, !exposed)
assert.deepEqual(exposed ? result.added : result.addedPrivate, [`new${ext}`])
}
