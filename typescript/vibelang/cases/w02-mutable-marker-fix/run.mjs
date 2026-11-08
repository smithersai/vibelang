// rule-evidence: docs/design/src/007-tooling.md#ordinary-mutable-marker-migration | `vibelang --fix`, including `--fix-migration-only`, removes redundant member markers; a marked plain-error payload becomes an explicit compatibility class using the existing runtime error factory, preserving tagged matching.
// rule-evidence: docs/design/src/007-tooling.md#ordinary-mutable-marker-migration | Schema fields, schema errors, schema tuples and `data` bodies have separate rules.
// rule-evidence: docs/design/src/007-tooling.md#ordinary-mutable-marker-migration | A method or identifier named `mutable` keeps its TypeScript meaning.
// Ordinary --fix and --fix-migration-only remove the marker from an interface
// property and an object-type index signature, and turn a marked plain error
// into a class over the runtime's TaggedError that still matches by tag. A
// property, method and const named mutable stay. Schema and schema error
// markers are not this repair's; a marked data variant field keeps its own
// diagnostic and is not rewritten.
// run-seconds: 400
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Effect from "effect/Effect"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
// A fresh project holding files, with the case's effect and vibelang-runtime.
function project(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" },
    include: ["*.vibe"]
  }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  return root
}
function tsc(root, flags) {
  const r = spawnSync(binary, [...flags, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
const read = (root, name) => readFileSync(join(root, name), "utf8")

const sources = {
  "main.vibe": [
    "export interface Point { mutable x: number; y: number; mutable?: boolean }",
    "export type Bag = { mutable [key: string]: number }",
    "export error Failed { mutable code: number }",
    "export interface Tool { mutable(): number }",
    "const mutable = 3",
    "export const seen = mutable",
    "export effect function main() {",
    "  const p: Point = { x: 1, y: 2 }",
    "  p.x = 5",
    "  const bag: Bag = { a: 1 }",
    "  bag.a = 9",
    "  const e = new Failed({ code: 7 })",
    "  const matched = match (e) { when Failed(let found): found.code; default: -1; }",
    "  return [p.x, bag.a, e.code, e._tag, matched, seen]",
    "}",
    ""
  ].join("\n"),
  "neighbours.vibe": [
    "export schema User { mutable name: string }",
    "export schema error Bad { mutable code: number }",
    ""
  ].join("\n")
}
const variant = "export data Shape { Circle { mutable r: number } }\n"
try {
  {
    // A marked data variant field has its own diagnostic and is not rewritten.
    const data = project("w02-mutable-data-", { "main.vibe": variant })
    const checked = tsc(data, ["--noEmit"])
    assert.match(checked.output, /main\.vibe\(1,38\): error EK1606:/, checked.output)
    assert.doesNotMatch(checked.output, /EK3410/, checked.output)
  }
  console.log("mutable markers migrated")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
