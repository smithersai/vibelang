// run-seconds: 390
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = resolve(here, "../../../built/local/tsc")
const dir = mkdtempSync(join(tmpdir(), "catch-execution-fix-"))
try {
  writeFileSync(join(dir, "main.vibe"), `const success = Effect.succeed(7)
const failure = Effect.fail("oops")
export effect function main() {
  const a = try success catch () => 0
  const b = try success as number + 1 catch () => 0
  const c = <number>try success + 2 catch () => 0
  const d = try failure satisfies never catch () => 0
  const fiber = fork Effect.succeed(5)
  const e = join fiber catch () => 0
  fork success catch () => 0
  return [a, b, c, d, e]
}
`)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], outDir: "out" }, include: ["*.vibe"] }))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  const fix = () => {
    const result = spawnSync(compiler, ["-p", dir, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr + "\nFixed source:\n" + readFileSync(join(dir, "main.vibe"), "utf8"))
    return readFileSync(join(dir, "main.vibe"), "utf8")
  }
  const after = fix()
  assert.match(after, /effect\s*\{\s*return try success/)
  assert.match(after, /fork Effect\.catch\(success,/)
  assert.equal(fix(), after, "the preserving migration must reach a fixed point")
  writeFileSync(join(dir, "run.mjs"), 'import {Effect} from "effect"; import {main} from "./out/main.js"; console.log(JSON.stringify(await Effect.runPromise(main())))')
  const ran = spawnSync(process.execPath, [join(dir, "run.mjs")], { encoding: "utf8", timeout: 30000 })
  assert.ifError(ran.error)
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  assert.equal(ran.stdout.trim(), "[7,8,9,0,5]")
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("catch execution fixes retain values and reach a fixed point")
