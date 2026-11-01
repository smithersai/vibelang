import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = process.env.VIBELANG_COMPILER_BENCH_ROOT ?? fileURLToPath(new URL("../", import.meta.url))

function fixture(t, target, status) {
  const root = mkdtempSync(join(tmpdir(), "vibelang version probe-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text, executable = false) => {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    if (executable) chmodSync(file, 0o755)
  }
  for (const name of ["compiler.sh", "measure.py", "modules.sh", "gen-synthetic.mjs"]) {
    const file = join(root, "scripts/bench", name)
    mkdirSync(dirname(file), { recursive: true })
    cpSync(join(source, "scripts/bench", name), file)
  }
  put("packages/runtime/dist/index.js", "")
  put("packages/runtime/node_modules/effect/package.json", '{"name":"effect"}')
  const compiler = "#!/bin/sh\n" +
    'echo "$0 $1" >> "$BENCH_VERSION_TRACE"\n' +
    'if [ "$1" = --version ]; then\n' +
    '  echo "version stdout witness"\n' +
    '  echo "version stderr witness" >&2\n' +
    '  case "$0" in */upstream) exit "$UPSTREAM_VERSION_STATUS";; *) exit "$VIBELANG_VERSION_STATUS";; esac\n' +
    'fi\necho "Files: 1"\n'
  put("bin/compiler", compiler, true)
  put("bin/upstream", compiler, true)
  put("bin/bun", "#!/bin/sh\nexit 0\n", true)
  const trace = join(root, "trace")
  const args = [join(root, "scripts/bench/compiler.sh"), "--modules", "2", "--runs", "1", "--scale", "", "--out", join(root, "output")]
  if (target === "upstream") args.push("--upstream", join(root, "bin/upstream"))
  const result = spawnSync("sh", args, {
    encoding: "utf8", timeout: 60000,
    env: { ...process.env, VIBELANG: join(root, "bin/compiler"),
      PATH: join(root, "bin") + delimiter + process.env.PATH,
      BENCH_VERSION_TRACE: trace, VIBELANG_VERSION_STATUS: String(target === "compiler" ? status : 0),
      UPSTREAM_VERSION_STATUS: String(target === "upstream" ? status : 0) }
  })
  assert.ifError(result.error)
  return { ...result, calls: readFileSync(trace, "utf8").trim().split("\n") }
}

for (const target of ["compiler", "upstream"]) {
  for (const status of [1, 2, 7, 42, 126, 127, 128, 137, 143, 255]) {
    test("compiler benchmark stops when " + target + " version probe exits " + status, t => {
      const result = fixture(t, target, status)
      assert.equal(result.status, status, result.stdout + result.stderr)
      assert.match(result.stderr, /version stderr witness/)
      assert.doesNotMatch(result.stdout, /synthetic 2 modules|working directory:/)
      assert.equal(result.calls.length, target === "upstream" ? 2 : 1, result.calls.join("\n"))
      assert.ok(result.calls.every(call => call.endsWith(" --version")))
    })
  }
  test("compiler benchmark measures after successful " + target + " version probes", t => {
    const result = fixture(t, target, 0)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /compiler: version stdout witness/)
    if (target === "upstream") assert.match(result.stdout, /upstream: version stdout witness/)
    assert.match(result.stdout, /working directory:/)
    assert.equal(result.calls.length, target === "upstream" ? 5 : 3)
  })
}
