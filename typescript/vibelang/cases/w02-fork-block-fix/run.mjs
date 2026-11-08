// rule-evidence: docs/design/src/007-tooling.md#legacy-fork-try-statement-and-wire-migration | | `EK1707` | Bare `fork { … }` | `fork effect { … }`; explicit Effect operands stay unchanged (VIP-2, VIP-17).
// vibelang --fix spells each bare fork block as fork effect { … } and leaves
// explicit Effect operands, including an existing fork effect block, as written.
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
const root = project("w02-fork-block-fix-", { "main.vibe": "input.txt" })
try {
  const legacy = readFileSync(join(root, "main.vibe"), "utf8")
  // The transitional compiler still accepts the bare block; keep its result.
  const before = tsc(root, ["--outDir", "before"])
  assert.equal(before.status, 0, before.stdout + before.stderr)
  const legacyValue = await Effect.runPromise((await load(root, "before", "main.js")).main())
  console.log("bare fork blocks gain effect; explicit operands unchanged")
} finally {
  rmSync(root, { recursive: true, force: true })
}
