import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// VibeLang's own diagnostics are linked only into the real command, so a port
// such as floating-effect is proved here and not in the lint package's Go tests.
const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"

function lint(rules, source) {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-lint-rules-"))
  try {
    const effect = dirname(createRequire(import.meta.url).resolve("effect/package.json"))
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(effect, join(dir, "node_modules", "effect"))
    writeFileSync(join(dir, "package.json"), '{"private":true,"type":"module"}')
    writeFileSync(join(dir, "tsconfig.json"), '{"compilerOptions":{"target":"es2022","module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"files":["m.vibe"]}')
    writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify({ rules }))
    writeFileSync(join(dir, "m.vibe"), source)
    return spawnSync(process.execPath, [launcher, "lint"], { cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, NO_COLOR: "1" } })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const header = 'import * as Effect from "effect/Effect"\n'

// toolcover-alchemy's two repros: 0 errors under vibelang lint, against an error for the .ts twin under Oxlint.
test("effect-succeed-with-void reports a .vibe file under its imported code", { skip }, () => {
  const result = lint({ "effecttsgo/effect-succeed-with-void": "error" }, header + "export const e = Effect.succeed(undefined)\n")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /m\.vibe\(2,18\): error EK3834: effectSucceedWithVoid:/)
  assert.equal(result.stderr, "")
})

test("floating-effect reports a .vibe file once, through its port", { skip }, () => {
  const result = lint({ "effecttsgo/floating-effect": "error" }, header + "export const g = Effect.gen(function* () { Effect.succeed(1); return 1 })\n")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(result.stdout.match(/m\.vibe\(2,/g)?.length, 1, result.stdout)
  assert.match(result.stdout, /error EK4801:/)
})

test("a rule that misreads .vibe forms is named, and reports nothing", { skip }, () => {
  const result = lint({ "effecttsgo/missed-pipeable-opportunity": "error" }, header + "export const p = Effect.succeed(1) |> Effect.map(%, (n) => n + 1) |> Effect.map(%, (n) => n + 2)\n")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stderr, /do not run on \.vibe files: missed-pipeable-opportunity\./)
  assert.doesNotMatch(result.stdout, /m\.vibe/)
})
