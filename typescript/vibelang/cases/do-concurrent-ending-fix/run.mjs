// run-seconds: 180
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"
import { Effect } from "effect"
import { collect } from "./out/main.js"

const expected = { kind: "undefined", seen: [1, 2, 3] }
assert.deepEqual(await Effect.runPromise(collect()), expected)
const dir = mkdtempSync(fileURLToPath(new URL("./.fix-", import.meta.url)))
try {
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(dir, "node_modules"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), readFileSync(new URL("./tsconfig.json", import.meta.url)))
  const legacy = readFileSync(new URL("./main.vibe", import.meta.url), "utf8").replaceAll("{ for concurrent", "for concurrent").replaceAll("; void 0 as void; }", "")
  writeFileSync(join(dir, "main.vibe"), legacy)
  const binary = process.env.VIBELANG_BINARY
  assert.ok(binary, "the harness supplies its compiler")
  const compile = flags => {
    const r = spawnSync(binary, ["-p", dir, "--pretty", "false", ...flags], { encoding: "utf8" })
    assert.ifError(r.error)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  compile(["--fix"])
  const fixed = readFileSync(join(dir, "main.vibe"), "utf8")
  assert.notEqual(fixed, legacy, "applied a preserving rewrite")
  assert.equal(readFileSync(join(dir, "out/main.d.ts"), "utf8"), readFileSync(new URL("./out/main.d.ts", import.meta.url), "utf8"), "preserved declaration types")
  const repaired = await import(pathToFileURL(join(dir, "out/main.js")))
  assert.deepEqual(await Effect.runPromise(repaired.collect()), expected)
  compile(["--fix"])
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), fixed)
  console.log("preserved undefined and item order")
} finally {
  rmSync(dir, { recursive: true, force: true })
}
