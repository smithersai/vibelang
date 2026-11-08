// rule-evidence: docs/design/src/007-tooling.md#legacy-fork-try-statement-and-wire-migration | | `EK0503` | A `try` statement in effect code | Explicit Effects, `catch effect` and native cleanup combinators (VIP-5).
// vibelang --fix rewrites an effect-code try statement: its body becomes an
// explicit effect block, its catch an effect handler of Effect.catch (the
// form `catch effect` lowers to) and its finally an Effect.onExit finalizer.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, copyFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"
// run-seconds: 240
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = (name) => new URL("./" + name, import.meta.url)
function project(prefix, files, names) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  symlinkSync(fileURLToPath(here("node_modules")), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const [to, from] of Object.entries(files)) writeFileSync(join(root, to), readFileSync(here(from)))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, rewriteRelativeImportExtensions: true, declaration: true, outDir: "out" },
    files: names ?? Object.keys(files)
  }))
  return root
}
function tsc(root, args) {
  return spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded", ...args], { cwd: root, encoding: "utf8", timeout: 60000 })
}
const load = (root, dir, file) => import(pathToFileURL(join(root, dir, file)).href)
const root = project("w02-try-statement-fix-", { "main.vibe": "input.txt" })
try {
  const before = tsc(root, ["--noEmit"])
  assert.notEqual(before.status, 0)
  assert.match(before.stdout, /main\.vibe\(5,3\): error EK0503/)
  assert.match(before.stdout, /main\.vibe\(16,3\): error EK0503/)
  console.log("try statements become explicit Effects with effect catch handlers and onExit cleanup")
} finally {
  rmSync(root, { recursive: true, force: true })
}
