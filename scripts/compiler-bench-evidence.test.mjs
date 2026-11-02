import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

test("compiler benchmarks retain every target and trial across repeated output-directory use", t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang benchmark evidence-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text, executable = false) => {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, text)
    if (executable) chmodSync(target, 0o755)
    return target
  }
  for (const name of ["compiler.sh", "modules.sh", "measure.py", "gen-synthetic.mjs"]) {
    const target = join(root, "scripts/bench", name)
    mkdirSync(dirname(target), { recursive: true })
    cpSync(join(source, "scripts/bench", name), target)
  }
  put("package.json", '{"type":"module"}')
  put("packages/runtime/dist/index.js", "")
  put("packages/runtime/node_modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
  const compiler = put("fixture.mjs", [
    'import { existsSync, readFileSync, writeFileSync } from "node:fs"',
    'if (process.argv.includes("--version")) { console.log("fixture"); process.exit(0) }',
    'const file = process.env.BENCH_TRIAL_COUNTER',
    'const n = existsSync(file) ? Number(readFileSync(file, "utf8")) + 1 : 1',
    'writeFileSync(file, String(n))',
    'console.log("Files: 3\\nCheck time: 0.01s\\nTotal time: 0.02s\\nTRIAL=" + n)',
    'console.error("stderr trial " + n + " Ω日本")',
    'if (n === 1) { console.log("main.vibe(1,1): error EK9999: first trial only"); process.exit(3) }',
  ].join("\n"))
  put("packages/compiler/native/vibelang",
    "#!/bin/sh\nexec " + quote(process.execPath) + " " + quote(compiler) + ' "$@"\n', true)
  // Only docs extraction is omitted. Synthetic generation, staging, measurement
  // and table rendering use the real scripts; the child is a diagnostic fixture.
  put("bin/bun", "#!/bin/sh\nexit 0\n", true)
  const out = join(root, "output Ω")
  const env = { ...process.env, TMPDIR: root, PATH: join(root, "bin") + delimiter + process.env.PATH,
    BENCH_TRIAL_COUNTER: join(root, "counter") }
  delete env.VIBELANG
  const invoke = () => spawnSync("sh", [
    join(root, "scripts/bench/compiler.sh"), "--modules", "2", "--runs", "3", "--scale", "", "--out", out
  ], { cwd: root, env, encoding: "utf8", timeout: 30_000 })
  const first = invoke()
  assert.equal(first.status, 0, first.stdout + first.stderr)
  assert.match(first.stdout, /exit 0,3, 1 errors/)
  const snapshots = () => readdirSync(join(out, "measurements")).sort().map(name => {
    const invocation = join(out, "measurements", name)
    return {
      invocation,
      targets: readdirSync(invocation).sort().map(target => {
        const path = join(invocation, target)
        return { path, bytes: readFileSync(join(path, "result.json"), "utf8"),
          result: JSON.parse(readFileSync(join(path, "result.json"), "utf8")) }
      })
    }
  })
  const saved = snapshots()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].targets.length, 2)
  const check = (invocation, offset) => {
    assert.deepEqual(invocation.targets.map(t => t.result.label), [
      "synthetic 2 modules, VibeLang", "synthetic 2 modules, Effect TS, this compiler"
    ])
    for (const [targetIndex, target] of invocation.targets.entries()) {
      const { result } = target
      assert.equal(result.schemaVersion, 1)
      assert.equal(result.cwd, root)
      assert.deepEqual(result.command, [join(root, "packages/compiler/native/vibelang"), "-p",
        join(out, "synth", targetIndex ? "effect-ts" : "vibelang", "tsconfig.json"),
        "--extendedDiagnostics", "--pretty", "false"])
      assert.equal(result.samples.length, 3)
      for (const [trial, sample] of result.samples.entries()) {
        const n = offset + targetIndex * 3 + trial + 1
        assert.equal(sample.exitCode, n === 1 ? 3 : 0)
        assert.equal(sample.errors, n === 1 ? 1 : 0)
        assert.equal(sample.files, 3)
        assert.equal(sample.checkSeconds, 0.01)
        assert.equal(sample.totalSeconds, 0.02)
        assert.ok(Number.isFinite(sample.wallSeconds) && sample.wallSeconds >= 0)
        assert.ok(Number.isFinite(sample.peakRssMiB) && sample.peakRssMiB > 0)
        const log = readFileSync(join(target.path, sample.log), "utf8")
        assert.match(log, new RegExp("TRIAL=" + n + "\\n"))
        assert.ok(log.includes("stderr trial " + n + " Ω日本"))
        assert.match(log, /MEASURE wall_s=/)
      }
    }
  }
  check(saved[0], 0)
  const second = invoke()
  assert.equal(second.status, 0, second.stdout + second.stderr)
  const repeated = snapshots()
  assert.equal(repeated.length, 2, "a repeated --out retains the previous invocation")
  const fresh = repeated.find(r => r.invocation !== saved[0].invocation)
  check(fresh, 6)
  for (const target of saved[0].targets) {
    assert.equal(readFileSync(join(target.path, "result.json"), "utf8"), target.bytes)
  }
  check(saved[0], 0)
  assert.match(readFileSync(join(out, "run.log"), "utf8"), /TRIAL=12\n/)
  assert.equal(readFileSync(join(out, "runs.txt"), "utf8").trim().split("\n").length, 3)
  assert.ok(first.stdout.includes("measurements: " + saved[0].invocation))
  assert.ok(second.stdout.includes("measurements: " + fresh.invocation))
})
