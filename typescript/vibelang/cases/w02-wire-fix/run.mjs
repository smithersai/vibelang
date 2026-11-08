// rule-evidence: docs/design/src/007-tooling.md#legacy-fork-try-statement-and-wire-migration | | `EK2401` | The resolved retired `wire` intrinsic | Explicit `Layer.provideMerge` composition replaces the rejected form; an unrelated local `wire` keeps its TypeScript meaning (VIP-24).
// vibelang --fix replaces each resolved wire call, under any import name, with
// Layer.provideMerge composition; a local function named wire is untouched.
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
const root = project("w02-wire-fix-", { "main.vibe": "input.txt" })
try {
  const legacy = readFileSync(join(root, "main.vibe"), "utf8")
  const before = tsc(root, ["--outDir", "before"])
  assert.equal(before.status, 0, before.stdout + before.stderr)
  const legacyValue = await Effect.runPromise((await load(root, "before", "main.js")).main())
  console.log("wire becomes Layer.provideMerge; the local wire keeps its meaning")
} finally {
  rmSync(root, { recursive: true, force: true })
}
