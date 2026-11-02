import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

test("timing out the real watcher test reaps its native process before stdout arrives", {
  skip: process.platform === "win32",
  timeout: 30000
}, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-watcher-cancel-"))
  const pidFile = join(scratch, "native.pid")
  const preload = join(scratch, "mute-native.mjs")
  // The existing watcher test starts its real launcher and a native stand-in.
  // Suppress only that stand-in's ready message: the timeout must clean up
  // even when the test has not learned the native PID from stdout yet.
  writeFileSync(preload, `import { writeFileSync } from "node:fs"
if (process.argv[1] === process.env.VIBELANG_BINARY) {
  writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
  process.stdout.write = () => true
}
`)
  const env = {
    ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`
  }
  delete env.NODE_TEST_CONTEXT
  const runner = spawn(process.execPath, [
    "--test", "--test-name-pattern=^forwards termination to a running native watcher$",
    fileURLToPath(new URL("./launcher.test.mjs", import.meta.url))
  ], {
    detached: true,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })
  let output = "", guardExpired = false
  runner.stdout.on("data", (data) => { output += data })
  runner.stderr.on("data", (data) => { output += data })
  const killGroup = () => {
    try { process.kill(-runner.pid, "SIGKILL") } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
  const guard = setTimeout(() => { guardExpired = true; killGroup() }, 15000)
  t.after(() => {
    clearTimeout(guard)
    killGroup()
    rmSync(scratch, { recursive: true, force: true })
  })
  const [code] = await once(runner, "close")
  assert.ok(existsSync(pidFile), `native watcher never started:\n${output}`)
  const pid = Number(readFileSync(pidFile, "utf8"))
  assert.ok(pid > 0)
  assert.equal(guardExpired, false, `test runner hung after its watcher timeout:\n${output}`)
  assert.equal(code, 1, output)
  assert.match(output, /testTimeoutFailure|timed out/)
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" })
})
