import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { sidecarChanges } from "../lib/declarations.mjs"
const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")

const declare = (members, quote, order) => [
  `import type { Element } from ${quote}./dom.js${quote};`,
  "export interface Item<Name extends string> {",
  ...order(members).map((m) => `    ${m.readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}: ${m.type};`),
  "}",
  ""
].join("\n")


export function checkInDirectory(outDir, members, flip, reorder) {
const changed = flip && members.length > flip[0] % members.length
const after = members.map((m, i) => changed && i === flip[0] % members.length ? { ...m, [flip[1]]: !m[flip[1]] } : m)
writeFileSync(join(outDir, "item.d.ts"), declare(after, '"', (ms) => reorder ? [...ms].reverse() : ms))
const result = sidecarChanges(ts, { "src/item.d.vibe.ts": declare(members, "'", (ms) => ms) }, outDir)
assert.deepEqual(result.missing, [])
assert.deepEqual(result.changed.map((c) => c.file), changed ? ["src/item.d.vibe.ts"] : [])
}

export function check(members, flip, reorder) {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-earlier-property-"))
  try {
    writeFileSync(join(outDir, "dom.d.ts"), "export interface Element {}")
    return checkInDirectory(outDir, members, flip, reorder)
  } finally { rmSync(outDir, { recursive: true, force: true }) }
}
