import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = join(process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url)), "scripts/bench/compiler.sh")
const invalid = ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "1e0", "0x1", "+1", "9".repeat(5000), "", "1; echo unsafe"]
const cases = [
  ...["--modules", "--runs"].flatMap(flag => invalid.map(value => [flag, value])),
  ...invalid.filter(value => value !== "").map(value => ["--scale", "1 " + value + " 2"]),
  ["--scale", "*"], ["--scale", "1\r2"],
  ["--shapes", "chain unknown single"],
  ["--shapes", "*"], ["--shapes", "chain\vdense"]
]

function run(t, args, explicitOutput = true) {
  const root = mkdtempSync(join(tmpdir(), "compiler-bench-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const temp = join(root, "tmp")
  mkdirSync(temp)
  const out = join(root, "output")
  // The missing compiler makes the unmodified script stop safely even for an
  // infinite run count. Usage validation must happen before compiler discovery.
  const result = spawnSync("sh", [script, ...(explicitOutput ? ["--out", out] : []), ...args], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, TMPDIR: temp, VIBELANG: join(root, "missing-compiler") }
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  assert.equal(existsSync(out), false, result.stdout + result.stderr)
  assert.deepEqual(readdirSync(temp), [], result.stdout + result.stderr)
  return result
}

for (const [flag, value] of cases) {
  test(`compiler benchmark rejects ${flag}=${JSON.stringify(value.length > 80 ? value.slice(0, 80) + "…" : value)} before setup`, t => {
    const result = run(t, [flag, value])
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.ok(result.stderr.includes(flag), result.stderr)
  })
}

for (const flag of ["--upstream", "--modules", "--runs", "--scale", "--shapes", "--out"]) {
  test("compiler benchmark names a missing value for " + flag, t => {
    const result = run(t, [flag])
    assert.equal(result.status, 2, result.stdout + result.stderr)
    assert.ok(result.stderr.includes(flag), result.stderr)
    assert.match(result.stderr, /requires a value/)
  })
}

test("compiler benchmark checks generated fractional counts without creating a temp output", t => {
  for (let i = 1; i <= 32; i++) {
    const flag = i % 2 ? "--modules" : "--runs"
    const result = run(t, [flag, String(i + 0.25)], false)
    assert.equal(result.status, 2, result.stderr)
    assert.ok(result.stderr.includes(flag), result.stderr)
  }
})

// Valid options still reach compiler discovery. No enormous valid workload is
// generated: this checks only that validation accepts its boundary and defaults.
for (const args of [
  [], ["--modules", "1", "--runs", "1", "--scale", "", "--shapes", ""],
  ["--modules", "0002", "--runs", "01"],
  ["--modules", "9007199254740991", "--runs", "9007199254740991"],
  ["--scale", "1\t2\n3", "--shapes", "single\tdense\nchain"],
  ["--scale", "", "--shapes", "chain dense single"]
]) {
  test("compiler benchmark preserves valid workload " + JSON.stringify(args), t => {
    const result = run(t, args)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /no compiler at .*missing-compiler/)
  })
}
