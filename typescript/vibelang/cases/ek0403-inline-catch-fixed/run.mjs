import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect, Exit } from "effect"

// rule-evidence: docs/design/src/007-tooling.md#fix-ownership-and-preservation
// rule-evidence: docs/design/vips/0004-throw.md#retirement-of-the-empty-legacy-trust-wrapper
// VIP-4 proxy ruling, 2026-11-04: the actual --fix output must compile clean.
const here = dirname(fileURLToPath(import.meta.url))
const dir = mkdtempSync(join(here, ".inline-catch-"))
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  for (const name of ["foreign.ts", "package.json", "tsconfig.json"]) {
    writeFileSync(join(dir, name), readFileSync(join(here, name)))
  }
  const fixed = readFileSync(join(here, "main.vibe"), "utf8")
  const original = fixed.replace("try Effect.orDie(Effect.try({ try: () => log.info(x), catch: (e) => e }))", "log.info(x)")
  assert.notEqual(original, fixed)
  writeFileSync(join(dir, "main.vibe"), original)
  const compile = (...args) => execFileSync(process.env.VIBELANG_BINARY, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8" })
  compile("--fix")
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), fixed)
  assert.equal(compile(), "", "fixed program must report zero diagnostics")
  compile("--fix")
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), fixed, "--fix must be stable")
  const { work } = await import(pathToFileURL(join(dir, "out/main.js")).href)
  for (const value of [undefined, "message"]) {
    const actual = await Effect.runPromiseExit(work(value))
    const expected = await Effect.runPromiseExit(Effect.gen(function* () {
      if (value) value.length
      return 1
    }))
    assert(Exit.isSuccess(actual))
    assert.deepEqual(actual, expected)
  }
  console.log("inline catch: zero diagnostics; Exit preserved")
} finally {
  rmSync(dir, { recursive: true, force: true })
}
