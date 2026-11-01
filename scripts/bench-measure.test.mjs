import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

for (const stream of ["stdout", "stderr"]) for (const output of ["", "complete\n", "partial", "partial π", "\n\n"]) {
  test("measurement metadata starts on its own line after " + stream + "=" + JSON.stringify(output), () => {
    const result = spawnSync("python3", [
      join(source, "scripts/bench/measure.py"), process.execPath, "-e", "process." + stream + ".write(" + JSON.stringify(output) + ")"
    ], { encoding: "utf8", timeout: 10_000 })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    const lines = result.stdout.split("\n")
    assert.equal(lines.filter(line => /^MEASURE wall_s=[0-9.]+ rss_mb=[0-9.]+ exit=0$/.test(line)).length, 1, result.stdout)
    assert.ok(result.stdout.startsWith(output), result.stdout)
  })
}

for (const mode of ["success", "partial", "nonzero", "SIGTERM", "SIGKILL"]) {
  test("compiler benchmark retains the " + mode + " compiler measurement", t => {
    const root = mkdtempSync(join(tmpdir(), "compiler-bench-measure-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const put = (file, contents) => {
      const target = join(root, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, contents)
      return target
    }
    const executable = (file, contents) => {
      const target = put(file, contents)
      chmodSync(target, 0o755)
      return target
    }
    for (const name of ["compiler.sh", "measure.py", "modules.sh", "gen-synthetic.mjs"]) {
      const target = join(root, "scripts/bench", name)
      mkdirSync(dirname(target), { recursive: true })
      cpSync(join(source, "scripts/bench", name), target)
    }
    put("packages/runtime/dist/index.js", "")
    put("packages/runtime/node_modules/effect/package.json", '{"name":"effect","version":"4.1.0"}')
    // Real staging, generator, Python measurement, shell parsing and table
    // rendering; only the compiler process and docs extraction are fixtures.
    const core = put("compiler.py", [
      "import os, signal, sys",
      'if "--version" in sys.argv:',
      '    print("VibeLang fixture")',
      "    sys.exit(0)",
      'print("Files: 3\\nCheck time: 0.01s\\nTotal time: 0.02s", flush=True)',
      ...(mode === "partial" ? ['sys.stdout.write("partial diagnostic"); sys.stdout.flush()'] : []),
      ...(mode === "nonzero" ? ["sys.exit(7)"] : []),
      ...(mode.startsWith("SIG") ? ["os.kill(os.getpid(), signal." + mode + ")"] : [])
    ].join("\n"))
    const compiler = executable("compiler", "#!/bin/sh\nexec python3 " + quote(core) + ' "$@"\n')
    executable("bin/bun", "#!/bin/sh\nexit 0\n")
    const out = join(root, "output")
    const result = spawnSync("sh", [
      join(root, "scripts/bench/compiler.sh"), "--modules", "1", "--runs", "1", "--scale", "", "--out", out
    ], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, VIBELANG: compiler, PATH: join(root, "bin") + delimiter + process.env.PATH }
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const rows = result.stdout.split("\n").filter(line => /^\| synthetic 1 modules,/.test(line))
    assert.equal(rows.length, 2, result.stdout)
    for (const row of rows) {
      assert.match(row, /\| 3 \| [0-9.]+ \| 0.01 \| 0.02 \| [0-9]+ \|/)
      if (mode.startsWith("SIG")) assert.ok(row.includes("(exit " + (mode === "SIGKILL" ? -9 : -15) + ", 0 errors)"), row)
      else if (mode === "nonzero") assert.match(row, /\(exit 7, 0 errors\)/)
      else assert.doesNotMatch(row, /\(exit /)
    }
    const log = readFileSync(join(out, "run.log"), "utf8")
    if (mode === "partial") assert.ok(log.includes("partial diagnostic\nMEASURE "), log)
    if (mode.startsWith("SIG")) assert.match(log, new RegExp("^MEASURE .* exit=" + (mode === "SIGKILL" ? -9 : -15) + "$", "m"))
  })
}
