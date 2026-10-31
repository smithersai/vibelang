import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bench-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bench = join(root, "scripts/bench")
  mkdirSync(bench, { recursive: true })
  cpSync(process.env.VIBELANG_REGISTER_BENCH_SOURCE ?? new URL("./bench/register.mjs", import.meta.url), join(bench, "register.mjs"))
  // Stop at the first external operation, before generating any workload.
  // Even Infinity is safe to probe: reaching setup is already a failure.
  writeFileSync(join(bench, "modules.sh"), '#!/bin/sh\nmkdir -p "$1"\necho fixture-setup-started >&2\nexit 7\n')
  const compiler = join(root, "compiler")
  writeFileSync(compiler, "#!/bin/sh\nexit 0\n")
  chmodSync(compiler, 0o755)
  const register = join(root, "register.mjs")
  writeFileSync(register, "")
  let invocation = 0
  return (args, invalid = true) => {
    const out = join(root, "out-" + invocation++)
    const result = spawnSync(process.execPath, [
      join(bench, "register.mjs"), "--register", register, "--out", out, ...args
    ], { env: { ...process.env, VIBELANG: compiler }, encoding: "utf8", timeout: 10_000 })
    const context = JSON.stringify(args) + "\n" + result.stdout + result.stderr
    assert.equal(result.error, undefined, context)
    assert.equal(result.status, invalid ? 2 : 1, context)
    if (invalid) {
      assert.match(result.stderr, /usage: register.mjs/, context)
      assert.doesNotMatch(result.stderr, /fixture-setup-started/, context)
      assert.equal(existsSync(out), false, context)
    } else {
      assert.match(result.stderr, /fixture-setup-started/, context)
      assert.equal(existsSync(out), true, context)
    }
  }
}

for (const option of ["packages", "modules", "runs"]) {
  const minimum = option === "packages" ? 2 : 1
  for (const value of ["NaN", "Infinity", "-Infinity", "1e309", "no", "", " ", "-1", "0", String(minimum - 0.5), String(minimum + 0.5), "9007199254740992"]) {
    test(`register benchmark rejects --${option} ${JSON.stringify(value)} before setup`, t => {
      fixture(t)(["--" + option, value])
    })
  }
}

for (const value of ["NaN", "Infinity", "-Infinity", "1e309", "no", "", " ", "-0.1"]) {
  test(`register benchmark rejects --budget ${JSON.stringify(value)} before setup`, t => {
    fixture(t)(["--budget", value])
  })
}

test("register benchmark accepts finite workload boundaries and nonnegative budgets", t => {
  const run = fixture(t)
  run([], false)
  for (const option of ["packages", "modules", "runs"]) {
    for (const value of [option === "packages" ? "2" : "1", "3", "1e2", "9007199254740991"]) {
      run(["--" + option, value], false)
    }
  }
  for (const value of ["0", "0.25", "4.5", "1e2", String(Number.MAX_VALUE)]) run(["--budget", value], false)
})

test("register benchmark rejects generated fractional counts in every argument position", t => {
  const run = fixture(t)
  let seed = 0x16b37
  for (let i = 0; i < 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const option = ["packages", "modules", "runs"][seed % 3]
    const fraction = String((seed % 10000) + 2.5)
    const invalid = ["--" + option, fraction]
    const others = ["--packages", "2", "--modules", "1", "--runs", "1"].filter((_, index, args) =>
      args[index - index % 2] !== "--" + option)
    run(i % 2 ? [...invalid, ...others] : [...others, ...invalid])
  }
})
