// rule-evidence: docs/design/src/007-tooling.md#legacy-prelude-shorthand | All three `--fix` scopes select their resolved legacy bindings:
// rule-evidence: docs/design/src/007-tooling.md#legacy-prelude-shorthand | Written imports, local or ambient types, type parameters, already qualified exports and a namespace's own members keep their TypeScript meaning.
// The transitional compiler accepts the bare prelude Scope type, Option<A>
// and FileSystem.of without a diagnostic. Ordinary --fix, --fix-migration-only
// and --fix-vip-only each write Scope.Scope, Option.Option<A> and
// FileSystem.FileSystem.of, leave an already qualified export, a local
// interface named Scope and a type parameter named Scope alone, and keep the
// declarations byte-identical.
// run-seconds: 400
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

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
    "export type Maybe = Option<number>",
    "export const noop = FileSystem.of",
    "export function scoped(s: Scope): number { return 1 }",
    "export const key = FileSystem.FileSystem",
    ""
  ].join("\n"),
  "keep.vibe": [
    "interface Scope { readonly local: true }",
    "export function localScope(s: Scope): boolean { return s.local }",
    "export function param<Scope>(s: Scope): Scope { return s }",
    ""
  ].join("\n")
}
const want = [
  "export type Maybe = Option.Option<number>",
  "export const noop = FileSystem.FileSystem.of",
  "export function scoped(s: Scope.Scope): number { return 1 }",
  "export const key = FileSystem.FileSystem",
  ""
].join("\n")
try {
  for (const flags of [["--fix"], ["--fix", "--fix-migration-only"], ["--fix-vip-only", "--fix"]]) {
    const root = project("w02-prelude-shorthand-", sources)
    const before = tsc(root, [])
    assert.equal(before.status, 0, before.output)
    assert.equal(before.output, "", "the transitional compiler accepts the shorthand without a diagnostic")
    const declarations = { main: read(root, "out/main.d.ts"), keep: read(root, "out/keep.d.ts") }

    const fixed = tsc(root, flags)
    assert.equal(fixed.status, 0, fixed.output)
    assert.equal(read(root, "main.vibe"), want, flags.join(" ") + "\n" + fixed.output)
    assert.equal(read(root, "keep.vibe"), sources["keep.vibe"], "a local type and a type parameter named Scope keep their meaning")

    const after = tsc(root, [])
    assert.equal(after.status, 0, after.output)
    assert.equal(after.output, "", after.output)
    assert.equal(read(root, "out/main.d.ts"), declarations.main, flags.join(" ") + ": declarations stay unchanged")
    assert.equal(read(root, "out/keep.d.ts"), declarations.keep)
    const repeat = tsc(root, flags)
    assert.equal(repeat.status, 0, repeat.output)
    assert.equal(read(root, "main.vibe"), want, "a second run writes nothing")
  }
  console.log("prelude shorthand migrated")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
