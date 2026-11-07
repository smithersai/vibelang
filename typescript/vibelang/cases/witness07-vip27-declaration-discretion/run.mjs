// run-seconds: 120
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { compareApiIdentity, loadTypeScript } from "../../../../scripts/api-identity.mjs"

const ts = loadTypeScript()
const deps = { "one.d.ts": "export interface One { x: number }", "two.d.ts": "export interface Two { y: string }" }
function compare(before, after) {
  const root = mkdtempSync(join(tmpdir(), "witness07-discretion-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) for (const [name, text] of Object.entries({ ...deps, ...files })) {
      mkdirSync(dirname(join(root, side, name)), { recursive: true })
      writeFileSync(join(root, side, name), text)
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), { compilerOptions: { lib: ["lib.es5.d.ts"] } })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const base = [
  'import type { One } from "./one.js";',
  'import type { Two } from "./two.js";',
  "/** A pair. */",
  'export interface Pair { a: One; b: Two; tag: "pair" }',
  "/** Makes a pair. */",
  "export declare function make(a: One, b: Two): Pair;",
].join("\n")
const index = text => ({ "index.d.ts": text })

// Ignored: formatting, quote style, import extension spelling, import order and member order.
const ignored = {
  formatting: base.replace(/; /g, ";\n    ").replace(/\n/g, "\n\n"),
  quotes: base.replaceAll('"', "'"),
  extensions: base.replace('"./one.js"', '"./one"').replace('"./two.js"', '"./two"'),
  "import order": base.split("\n").slice(1, 2).concat(base.split("\n").slice(0, 1), base.split("\n").slice(2)).join("\n"),
  "member order": base.replace('{ a: One; b: Two; tag: "pair" }', '{ tag: "pair"; b: Two; a: One }'),
}
for (const [name, after] of Object.entries(ignored)) {
  assert.notEqual(after, base, name)
  const result = compare(index(base), index(after))
  assert.equal(result.identical, true, name + ": " + JSON.stringify(result))
}

// Counted: an exported name, a type, and a doc comment.
const counted = {
  nameDifferences: base.replace("export declare function make", "export declare function build"),
  typeDifferences: base.replace('tag: "pair"', "tag: string"),
  docDifferences: base.replace("/** Makes a pair. */", "/** Builds a pair. */"),
}
for (const [kind, after] of Object.entries(counted)) {
  const result = compare(index(base), index(after))
  assert.equal(result.identical, false, kind)
  assert.ok(result[kind].length > 0, kind + ": " + JSON.stringify(result))
}
console.log("declaration identity ignores spelling and order, and counts names, types and docs")
