import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareDeclarations } from "../lib/declarations.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")

const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-mts-declaration-pairing.json", import.meta.url), "utf8"))

function compare(stem, before, after, { collision = false, pair = true, beforePublic = true, afterPublic = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-mts-dts-"))
  try {
    const oldName = stem + ".d.mts"
    const newName = stem + ".d.ts"
    const put = (dir, file, text) => {
      mkdirSync(join(root, dir, file, ".."), { recursive: true })
      writeFileSync(join(root, dir, file), text)
    }
    put("before", oldName, before)
    if (collision) put("before", newName, after)
    put("after", pair ? newName : "other.d.ts", after)
    for (const [dir, name, published] of [["before", oldName, beforePublic], ["after", pair ? newName : "other.d.ts", afterPublic]]) {
      const entry = "__published_entry__.d.ts"
      put(dir, entry, published ? "export * from " + JSON.stringify("./" + name.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.ts$/, ".js")) + ";\n" : "export {};\n")
      put(dir, "package.json", JSON.stringify({ type: "module", types: "./" + entry }))
      put(dir, "public-surface.json", JSON.stringify({ roots: [entry], reachable: [entry, ...(published ? [name] : [])], unresolved: [] }))
    }
    return compareDeclarations(ts, join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

export function check(parts, mutation) {
      const before = 'export declare const answer: "yes" | "no";\n'
      const after = mutation === "type" ? 'export declare const answer: number;\n'
        : mutation === "quote" ? "export declare const answer: 'yes' | 'no';\n" : mutation + before
      const result = compare(parts.join("/"), before, after)
      assert.equal(result.identical, mutation !== "type")
      assert.deepEqual(result.added, [])
      assert.deepEqual(result.removed, [])
      if (mutation === "type") assert.deepEqual(result.changed.map(x => x.file), ["__published_entry__.d.ts"])

}

export { compare }
