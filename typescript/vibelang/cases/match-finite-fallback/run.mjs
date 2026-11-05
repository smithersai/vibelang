// run-seconds: 120
import assert from "node:assert/strict"
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Effect, Exit } from "effect"

const here = dirname(fileURLToPath(import.meta.url))
const fallback = "    default: match (void 0 as unknown) { when 0: (void 0 as never); };\n"
const original = readFileSync(join(here, "main.vibe"), "utf8")
assert.equal(original.split(fallback).length - 1, 3)
mkdirSync(join(here, ".cache"), { recursive: true })
const project = mkdtempSync(join(here, ".cache/finite-"))
try {
  writeFileSync(join(project, "main.vibe"), original.replaceAll(fallback, ""))
  writeFileSync(join(project, "tsconfig.json"), readFileSync(join(here, "tsconfig.json")))
  writeFileSync(join(project, "package.json"), '{"type":"module"}')
  symlinkSync(join(here, "node_modules"), join(project, "node_modules"), "dir")
  const fix = () => spawnSync(process.env.VIBELANG_BINARY, ["--pretty", "false", "--fix"], { cwd: project, encoding: "utf8", timeout: 120000 })
  const first = fix()
  assert.ifError(first.error)
  assert.equal(first.status, 0, "finite match --fix failed:\n" + first.stdout + first.stderr)
  assert.match(first.stdout + first.stderr, /EK4701 ×3\b/)
  const fixed = readFileSync(join(project, "main.vibe"), "utf8")
  assert.equal((fixed.match(/default:/g) || []).length, 3)
  const second = fix()
  assert.ifError(second.error)
  assert.equal(second.status, 0, second.stdout + second.stderr)
  assert.equal(readFileSync(join(project, "main.vibe"), "utf8"), fixed)
  const actual = await import(pathToFileURL(join(project, "out/main.js")).href)
  const twin = await import("./typescript/out/main.js")
  for (const program of [actual, twin]) {
    assert.equal(program.choose(true), 1)
    assert.equal(await program.asyncChoose(true), 1)
    assert.equal(Effect.runSync(program.effectChoose(true)), 1)
    for (const value of [false, null]) {
      const emptyTypeError = (error) => error instanceof TypeError && error.message === ""
      assert.throws(() => program.choose(value), emptyTypeError)
      await assert.rejects(program.asyncChoose(value), emptyTypeError)
      const failed = Effect.runSyncExit(program.effectChoose(value))
      assert(Exit.isFailure(failed))
      assert.equal(failed.cause.reasons.length, 1)
      assert.equal(failed.cause.reasons[0]._tag, "Die")
      assert(emptyTypeError(failed.cause.reasons[0].defect))
    }
  }
} finally {
  rmSync(project, { recursive: true, force: true })
}
console.log("finite fallback preserved")
