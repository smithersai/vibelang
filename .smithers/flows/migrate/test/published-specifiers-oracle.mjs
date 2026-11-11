import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareDeclarations } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const manifest = { name: "@opencode/stats-core", types: "./index.d.ts", exports: { ".": { types: "./index.d.ts" } } }

export function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "migrate-published-specifiers-"))
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


export const forms = [
  (s, n) => `export * as M${n} from "${s}";`,
  (s, n) => `export { value as v${n} } from "${s}";`,
  (s, n) => `import type { Value as V${n} } from "${s}";\nexport type T${n} = V${n};`,
  (s, n) => `export declare const c${n}: import("${s}").Value;`
]

export function check(modules, mutate) {
const before = {}, after = {}
const lines = { before: [], after: [] }
let renamed = 0
modules.forEach(({ form, renamed: rename, directory }, n) => {
  const file = directory ? `m${n}/index.d.ts` : `m${n}.d.ts`
  const text = "export declare const value: number;\nexport type Value = number;\n"
  before[file] = after[file] = text
  const base = directory ? `./m${n}/index` : `./m${n}`
  lines.before.push(forms[form](rename ? base : base + ".js", n))
  lines.after.push(forms[form](base + ".js", n))
  if (rename) renamed++
})
before["index.d.ts"] = lines.before.join("\n") + "\n"
after["index.d.ts"] = lines.after.join("\n") + "\n"
if (mutate !== undefined && after["index.d.ts"].includes(mutate)) {
  after["index.d.ts"] = after["index.d.ts"].replace(mutate, mutate + "X")
  assert.equal(compare(before, after).identical, false)
  return
}
const result = compare(before, after)
assert.equal(result.identical, true, JSON.stringify(result.changed))
assert.equal(result.excused.length, renamed)
for (const pair of result.excused) assert.equal(pair.after, pair.before + ".js")
}
