import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { constants } from "node:os"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./bench/measure.py", import.meta.url))

function measure(code) {
  const result = spawnSync("python3", [script, process.execPath, "-e", code], {
    encoding: "utf8", timeout: 10000
  })
  assert.ifError(result.error)
  assert.equal(result.signal, null, result.stderr)
  const receipt = /MEASURE wall_s=(\d+\.\d+) rss_mb=(\d+\.\d+) exit=(-?\d+)\n$/.exec(result.stdout)
  assert.ok(receipt, result.stdout + result.stderr)
  assert.ok(Number(receipt[1]) >= 0)
  assert.ok(Number(receipt[2]) >= 0)
  return { ...result, measuredExit: Number(receipt[3]) }
}

// Include shell-reserved statuses and generated values across the full byte range.
const statuses = new Set([0, 1, 2, 7, 42, 126, 127, 128, 130, 137, 143, 255])
let seed = 6201
for (let i = 0; i < 32; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  statuses.add(seed >>> 24)
}
for (const status of statuses) {
  test("measurement preserves child exit status " + status, () => {
    const result = measure('process.stdout.write("stdout witness\\n"); process.stderr.write("stderr witness\\n"); process.exitCode = ' + status)
    assert.equal(result.measuredExit, status)
    assert.equal(result.status, status, result.stdout + result.stderr)
    assert.match(result.stdout, /stdout witness\n/)
    assert.match(result.stdout, /stderr witness\n/)
  })
}

for (const signal of ["SIGTERM", "SIGKILL", "SIGINT"]) {
  test("measurement reports signal death as shell failure: " + signal, { skip: process.platform === "win32" }, () => {
    const result = measure('process.stdout.write("before signal\\n"); process.kill(process.pid, ' + JSON.stringify(signal) + ')')
    assert.equal(result.measuredExit, -constants.signals[signal])
    assert.equal(result.status, 128 + constants.signals[signal], result.stdout + result.stderr)
    assert.match(result.stdout, /before signal\n/)
  })
}

test("measurement retains non-UTF8 output and output without a trailing newline", () => {
  const result = measure("process.stdout.write(Buffer.from([0xff, 0x61])); process.exitCode = 9")
  assert.equal(result.measuredExit, 9)
  assert.equal(result.status, 9)
  assert.match(result.stdout, /^�a\nMEASURE wall_s=/)
})
