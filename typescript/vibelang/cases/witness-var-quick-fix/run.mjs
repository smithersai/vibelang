// run-seconds: 150
// rule-evidence: docs/design/src/001-functions.md#meaning | | `var` | every `var` declaration, `for (var …)` included; a declaration rejected by a `do` early error uses the [specific diagnostics](002-running.md#do-expressions) | `let`, or `const` when the binding is never assigned |
// The table's quick fix for `var` writes `const` for a binding that is never
// assigned and `let` for one that is.
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? resolve(here, "../../../built/local/tsc")
const dir = mkdtempSync(join(tmpdir(), "var-quick-fix-"))
try {
  writeFileSync(join(dir, "main.vibe"), "export function constant(): number { var n = 1; return n }\nexport function variable(): number { var m = 1; m++; return m }\n")
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], outDir: "out" }, include: ["*.vibe"] }))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  const result = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
  assert.ifError(result.error)
  const after = readFileSync(join(dir, "main.vibe"), "utf8")
  assert.equal(after, "export function constant(): number { const n = 1; return n }\nexport function variable(): number { let m = 1; m++; return m }\n", result.stdout + result.stderr + "\nFixed source:\n" + after)
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("var quick fix writes const and let")
