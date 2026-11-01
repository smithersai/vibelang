import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

// Exercise the actual CLI and real child processes. Only the measurement clock
// is controlled: scheduler noise must not decide whether an invalid ratio passes.
function benchmark(t, samples, budget = 4.5) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-register-ratio-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bench = join(root, "scripts/bench")
  mkdirSync(bench, { recursive: true })
  cpSync(new URL("./bench/register.mjs", import.meta.url), join(bench, "register.mjs"))
  writeFileSync(join(bench, "modules.sh"), '#!/bin/sh\nmkdir -p "$1/node_modules"\n')
  const trace = join(root, "compiler.log")
  const compiler = join(root, "compiler")
  writeFileSync(compiler, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BENCH_RATIO_TRACE"\n')
  chmodSync(compiler, 0o755)
  const register = join(root, "register.mjs")
  writeFileSync(register, 'console.log("4"); process.exit(0)\n')
  const clock = join(root, "clock.mjs")
  const ticks = samples.flatMap(sample =>
    [sample.start, sample.check, sample.cold, sample.warm].flatMap(ms => [0, ms]))
  writeFileSync(clock, [
    'import { performance } from "node:perf_hooks"',
    "const ticks = " + JSON.stringify(ticks),
    'Object.defineProperty(performance, "now", {value: () => {',
    '  if (!ticks.length) throw new Error("fixture clock exhausted")',
    '  return ticks.shift()',
    '}})'
  ].join("\n"))
  const out = join(root, "output")
  const result = spawnSync(process.execPath, [
    "--import", pathToFileURL(clock).href, join(bench, "register.mjs"),
    "--packages", "2", "--modules", "1", "--runs", String(samples.length),
    "--budget", String(budget), "--register", register, "--out", out
  ], {
    env: { ...process.env, VIBELANG: compiler, BENCH_RATIO_TRACE: trace },
    encoding: "utf8", timeout: 30_000
  })
  assert.equal(result.error, undefined, result.stderr)
  const compiles = readFileSync(trace, "utf8").trim().split("\n")
  return { ...result, compiles }
}

for (const [name, sample] of [
  ["zero check baseline and zero numerator", {start: 10, check: 10, cold: 30, warm: 10}],
  ["negative check baseline", {start: 20, check: 10, cold: 100, warm: 10}],
  ["negative baseline and numerator", {start: 20, check: 10, cold: 30, warm: 10}],
  ["ratio overflow", {start: 0, check: Number.MIN_VALUE, cold: 1, warm: 0}],
  ["negative adjusted cold time", {start: 10, check: 20, cold: 20, warm: 10}],
  ["warm run slower than cold", {start: 10, check: 20, cold: 20, warm: 30}],
  ["zero check baseline and positive numerator", {start: 10, check: 10, cold: 40, warm: 10}]
]) {
  test("register benchmark rejects inconclusive sample: " + name, t => {
    const result = benchmark(t, [sample])
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /inconclusive timing sample 1/)
    for (const [phase, value] of Object.entries(sample)) {
      assert.ok(result.stderr.includes(phase + "=" + value), result.stderr)
    }
    assert.doesNotMatch(result.stderr, /over budget/)
    assert.equal(result.stdout, "", "an inconclusive sample must not print a budget verdict")
    assert.equal(result.compiles.length, 2)
  })
}

for (const [name, sample, budget, status, ratio] of [
  ["under budget", {start: 10, check: 30, cold: 70, warm: 10}, 4.5, 0, "2.00"],
  ["over budget", {start: 10, check: 30, cold: 150, warm: 10}, 4.5, 1, "6.00"],
  ["exact budget", {start: 10, check: 30, cold: 120, warm: 10}, 4.5, 0, "4.50"],
  ["zero adjusted cold time", {start: 10, check: 30, cold: 30, warm: 10}, 0, 0, "0.00"]
]) {
  test("register benchmark retains valid budget verdict: " + name, t => {
    const result = benchmark(t, [sample], budget)
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.ok(result.stdout.includes("ratio " + ratio + " (budget " + budget + ")"), result.stdout)
    assert.equal(result.compiles.length, 2)
    if (status) assert.match(result.stderr, /over budget/)
    else assert.equal(result.stderr, "")
  })
}

test("register benchmark does not hide an invalid run inside a valid median", t => {
  const good = {start: 10, check: 30, cold: 70, warm: 10}
  const result = benchmark(t, [good, {start: 20, check: 10, cold: 100, warm: 10}, good])
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /inconclusive timing sample 2/)
  assert.equal(result.stdout, "")
  assert.equal(result.compiles.length, 4, "stop before spending another run on an unusable measurement")
})

test("register benchmark computes the median of valid per-run ratios", t => {
  const result = benchmark(t, [
    {start: 10, check: 30, cold: 70, warm: 10},
    {start: 10, check: 30, cold: 150, warm: 10},
    {start: 10, check: 30, cold: 90, warm: 10}
  ])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /ratio 3.00 \(budget 4.5\); each run: 2.00, 6.00, 3.00/)
  assert.equal(result.compiles.length, 6)
})

test("register benchmark rejects generated baseline and overhead neighbourhoods", async t => {
  for (let n = 1; n <= 8; n++) {
    const start = n * n + 0.25
    const warm = n + 0.5
    for (const [kind, check, cold] of [
      ["zero baseline", start, warm + 2 * start],
      ["negative baseline", start - n / 16, warm + 3 * start],
      ["negative overhead", start + n, warm + 2 * start - n / 16]
    ]) {
      await t.test(kind + " at " + n, t => {
        const result = benchmark(t, [{start, check, cold, warm}])
        assert.equal(result.status, 1, result.stdout + result.stderr)
        assert.match(result.stderr, /inconclusive timing sample 1/)
        assert.equal(result.stdout, "")
      })
    }
  }
})
