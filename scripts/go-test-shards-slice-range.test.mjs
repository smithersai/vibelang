import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

function runBounded(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, detached: true })
    let stdout = "", stderr = "", timedOut = false
    child.stdout.setEncoding("utf8").on("data", text => { stdout += text })
    child.stderr.setEncoding("utf8").on("data", text => { stderr += text })
    const timer = setTimeout(() => {
      timedOut = true
      // A huge denominator can trap awk in partitioning. Kill this fixture's
      // whole group so a regression cannot leave its descendants running.
      try { process.kill(-child.pid, "SIGKILL") } catch (error) {
        if (error.code !== "ESRCH") reject(error)
      }
    }, 10_000)
    child.on("error", error => { clearTimeout(timer); reject(error) })
    child.on("close", (status, signal) => {
      clearTimeout(timer)
      resolve({ status, signal, stdout, stderr, timedOut })
    })
  })
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "go slice range "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = join(root, "go-test-shards.sh")
  writeFileSync(script, readFileSync(process.env.GO_SHARDS_MODULE ?? new URL("./go-test-shards.sh", import.meta.url)))
  const binary = join(root, "pkg.test")
  writeFileSync(binary, `#!/bin/sh
echo called >> "$SLICE_CALLS"
case "$*" in *-test.list*) printf 'TestA\\nTestFails\\n'; exit 0;; esac
echo EXECUTED
exit 7
`, { mode: 0o700 })
  const calls = join(root, "calls")
  const temp = join(root, "tmp")
  mkdirSync(temp)
  return {
    calls,
    run(slice, fromFile = false) {
      if (fromFile) {
        const host = spawnSync("uname", ["-n"], { encoding: "utf8" }).stdout.trim()
        writeFileSync(join(root, "go-test-slice"), slice + " " + host + "\n")
      }
      return runBounded("sh", [script, binary], {
        cwd: root,
        env: { ...process.env, GO_TEST_SHARDS: "2", GO_TEST_SLICE: fromFile ? "" : slice, SLICE_CALLS: calls, TMPDIR: temp },
      })
    },
  }
}

// Decimal strings just beyond the shell's signed 64-bit range and much larger
// values must fail closed. A failed [ comparison must never count as "in range".
for (const value of ["9223372036854775808", "18446744073709551616", "999999999999999999999999"]) {
  for (const [slice, fromFile] of [[value + "/2", false], ["1/" + value, false], [value + "/2", true]]) {
    test("out-of-range slice is refused before discovery: " + slice + (fromFile ? " (host file)" : ""), async t => {
      const f = fixture(t)
      const r = await f.run(slice, fromFile)
      assert.equal(r.timedOut, false, r.stdout + r.stderr)
      assert.equal(r.status, 2, r.stdout + r.stderr)
      assert.match(r.stderr, /GO_TEST_SLICE=.*is not i\/n/)
      assert.doesNotMatch(r.stdout, /PASS|EXECUTED/)
      assert.equal(existsSync(f.calls), false, "invalid configuration must not even list the test binary")
    })
  }
}

test("generated overflowing indices never certify an empty slice", async t => {
  const f = fixture(t)
  let state = 159
  for (let i = 0; i < 64; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const value = "9" + String(state).padStart(10, "0") + String(i).padStart(10, "0")
    const r = await f.run(value + "/" + (1 + state % 8))
    assert.equal(r.timedOut, false, r.stdout + r.stderr)
    assert.equal(r.status, 2, value + ": " + r.stdout + r.stderr)
    assert.match(r.stderr, /GO_TEST_SLICE=/)
    assert.doesNotMatch(r.stdout, /PASS|EXECUTED/)
    assert.equal(existsSync(f.calls), false)
  }
})

for (const slice of ["1/1", "1/2", "2/2", "01/02", "02/02"]) {
  test("valid slice retains a failing test process: " + slice, async t => {
    const f = fixture(t)
    const r = await f.run(slice)
    assert.equal(r.timedOut, false, r.stdout + r.stderr)
    assert.equal(r.status, 7, r.stdout + r.stderr)
    assert.match(r.stdout, /EXECUTED/)
    assert.ok(existsSync(f.calls))
  })
}
