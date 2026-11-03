import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { accessSync, constants, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const helper = process.env.VIBELANG_NATIVE_OUTPUT_SCRIPT ?? fileURLToPath(new URL("./native-output.sh", import.meta.url))
const posix = { skip: process.platform === "win32" }

// Real cp and rename exercise publication. The build writer only supplies an
// artifact; no compiler behavior is simulated or required for these contracts.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "native mode with spaces "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, "bin", "vibelang")
  const source = join(root, "input")
  mkdirSync(dirname(output), { recursive: true })
  const original = readFileSync("/bin/true")
  copyFileSync("/bin/true", output)
  const inode = statSync(output).ino
  const run = (operation = "copy", env = {}) => spawnSync("sh", [helper, operation, output, source], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, PATH: root + ":" + process.env.PATH, ...env }
  })
  const preserved = () => {
    assert.equal(statSync(output).ino, inode, "the previous publication keeps its inode")
    assert.deepEqual(readFileSync(output), original, "the previous publication keeps its bytes")
    assert.equal(spawnSync(output).status, 0, "the previous executable still runs")
    assert.deepEqual(readdirSync(dirname(output)), ["vibelang"], "temporary outputs are removed")
  }
  writeFileSync(join(root, "go"), `#!/bin/sh
[ "$1" = build ] && [ "$2" = -o ] || exit 98
case "$NATIVE_ARTIFACT" in
  directory) mkdir "$3"; printf content > "$3/member" ;;
  empty) : > "$3"; chmod 755 "$3" ;;
  regular) cp -p "$4" "$3" ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 })
  return { root, output, source, run, preserved }
}

for (const operation of ["copy", "build"]) {
  for (const mode of [0o600, 0o644, 0o660, 0o444]) {
    test(`${operation} rejects a non-executable result (mode ${mode.toString(8)})`, posix, t => {
      const f = fixture(t)
      writeFileSync(f.source, "#!/bin/sh\nexit 0\n", { mode })
      const result = f.run(operation, { NATIVE_ARTIFACT: "regular" })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.match(result.stderr, /native-output:.*not an executable file/)
      f.preserved()
    })
  }

  for (const mode of [0o700, 0o755, 0o711]) {
    test(`${operation} publishes an executable result (mode ${mode.toString(8)})`, posix, t => {
      const f = fixture(t)
      writeFileSync(f.source, "#!/bin/sh\nexit 17\n", { mode })
      const result = f.run(operation, { NATIVE_ARTIFACT: "regular" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.deepEqual(readFileSync(f.output), readFileSync(f.source))
      assert.equal(statSync(f.output).mode & 0o777, mode)
      assert.equal(spawnSync(f.output).status, 17)
      assert.deepEqual(readdirSync(dirname(f.output)), ["vibelang"])
    })
  }
}

for (const artifact of ["directory", "empty"]) {
  test("build rejects " + artifact + " output without changing the publication", posix, t => {
    const f = fixture(t)
    const result = f.run("build", { NATIVE_ARTIFACT: artifact })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /native-output:/)
    f.preserved()
  })
}

test("failed copy leaves the previous executable intact", posix, t => {
  const f = fixture(t)
  const result = f.run()
  assert.notEqual(result.status, 0)
  f.preserved()
})

test("invalid output with no previous executable does not publish a file", posix, t => {
  const f = fixture(t)
  rmSync(f.output)
  writeFileSync(f.source, "not executable\n", { mode: 0o644 })
  const result = f.run()
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(existsSync(f.output), false)
  assert.deepEqual(readdirSync(dirname(f.output)), [])
})

test("copy follows an executable input symlink and publishes a regular file", posix, async t => {
  const f = fixture(t)
  const { symlinkSync } = await import("node:fs")
  symlinkSync("/bin/true", f.source)
  const result = f.run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(lstatSync(f.output).isFile())
  assert.equal(spawnSync(f.output).status, 0)
})

test("generated permission modes obey the publication contract", posix, t => {
  // Deterministic neighbourhood of permission bits, with read/write modes on
  // each side of the execute boundary. Keep owner-readable fixture contents.
  for (let bits = 0; bits < 64; bits++) {
    const mode = 0o600 | (bits << 1)
    const f = fixture(t)
    writeFileSync(f.source, "#!/bin/sh\nexit 0\n", { mode })
    chmodSync(f.source, mode)
    const result = f.run()
    let executable = false
    try { accessSync(f.source, constants.X_OK); executable = true } catch {}
    assert.equal(result.status, executable ? 0 : 1, `mode ${mode.toString(8)}: ${result.stderr}`)
    if (!executable) f.preserved()
    else {
      assert.deepEqual(readFileSync(f.output), readFileSync(f.source))
      assert.equal(statSync(f.output).mode & 0o777, mode)
      assert.equal(spawnSync(f.output).status, 0)
    }
  }
})
