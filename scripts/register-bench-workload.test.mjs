import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

// The other register-bench tests drive the CLI with a fixture compiler, so a
// template writing syntax the language no longer has (a trailing block,
// EK1101) passed them while every real benchmark run failed at its first
// compile. This test compiles a generated package with the real compiler and
// runs the generated entry through vibelang/register.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const compiler = process.env.VIBELANG_BINARY || path.join(root, "packages/compiler/native/vibelang")
const generator = path.join(root, "scripts/bench/register.mjs")
const hook = path.join(root, "packages/compiler/register.mjs")

test("register benchmark generates a workload the compiler accepts and the hook runs", t => {
  for (const [file, setup] of [
    [compiler, "sh scripts/build-vibelang.sh"],
    [path.join(root, "packages/runtime/dist/index.js"), "(cd packages/runtime && bun install && bun run build)"],
    [path.join(root, "packages/runtime/node_modules/effect/package.json"), "(cd packages/runtime && bun install)"]
  ]) {
    if (!existsSync(file)) {
      assert.ok(!process.env.REGISTER_BENCH_REQUIRE, "missing prerequisite " + file + "; run " + setup)
      return t.skip("missing prerequisite " + file + "; run " + setup)
    }
  }
  const temp = mkdtempSync(path.join(tmpdir(), "vibelang-register-workload-"))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  // Generate with stand-ins for the timed commands; the compile and the hook run are checked below, once each.
  const stub = path.join(temp, "compiler")
  writeFileSync(stub, "#!/bin/sh\nexit 0\n")
  chmodSync(stub, 0o755)
  const register = path.join(temp, "register.mjs")
  writeFileSync(register, 'console.log("4"); process.exit(0)\n')
  const out = path.join(temp, "out")
  const generated = spawnSync(process.execPath, [generator, "--packages", "2", "--modules", "1", "--runs", "1", "--register", register, "--out", out], {
    env: { ...process.env, VIBELANG: stub }, encoding: "utf8", timeout: 120_000
  })
  // Its timing verdict on a two-package workload is noise; the workload it left on disk is what matters here.
  assert.equal(generated.error, undefined, generated.stdout + generated.stderr)
  assert.ok(existsSync(path.join(out, "packages/p1/src/m0.vibe")), generated.stdout + generated.stderr)
  const compiled = spawnSync(compiler, ["-p", path.join(out, "packages/p1/tsconfig.json"), "--noEmit", "--pretty", "false"], {
    encoding: "utf8", timeout: 120_000
  })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  assert.equal(compiled.stdout + compiled.stderr, "", "the benchmark workload must have zero diagnostics")
  const ran = spawnSync(process.execPath, ["--import", hook, "main.ts"], {
    cwd: out, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_CACHE_DIR: path.join(temp, "cache"), VIBELANG_DISABLE_CACHE: "", VIBELANG_PROJECT: "" }
  })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  assert.equal(ran.stdout.trim(), "4", "two packages of one module add 2 * 1 * 2")
})
