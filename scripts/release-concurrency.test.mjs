import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"

const root = fileURLToPath(new URL("../", import.meta.url))
const declaration = readFileSync(join(root, "PACKAGE.ts"), "utf8")
const match = declaration.match(/release:\s*check\(\s*"[^"]*",\s*("(?:[^"\\]|\\.)*")/)
assert.ok(match, "release target declares its command")
const command = JSON.parse(match[1])

// Execute the declared command on real files. Each worker announces its start,
// then waits for the parent to release it: the count measures live workers,
// independent of fixture duration or whether a machine finishes work quickly.
for (const failure of [false, true]) {
  test(`release bounds file workers, runs every file, and preserves ${failure ? "failure" : "success"}`, async t => {
    const dir = mkdtempSync(join(tmpdir(), "release-workers-"))
    const events = join(dir, "events")
    mkdirSync(events)
    const files = [
      ...Array.from({ length: 16 }, (_, i) => `scripts/release/${i}.test.mjs`),
      ...Array.from({ length: 15 }, (_, i) => `scripts/${i + 16}.test.mjs`),
      "typescript/vibelang/harness.test.mjs"
    ]
    for (const [id, file] of files.entries()) {
      mkdirSync(dirname(join(dir, file)), { recursive: true })
      writeFileSync(join(dir, file), `
import test from "node:test"
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
test("fixture-${id}", async () => {
  const events = process.env.RELEASE_WORKER_EVENTS
  writeFileSync(join(events, "${id}.start"), "")
  try {
    while (!existsSync(join(events, "release"))) await delay(20)
    if (process.env.RELEASE_WORKER_FAILURE === "${id}") throw new Error("deliberate fixture failure")
  } finally {
    writeFileSync(join(events, "${id}.end"), "")
  }
})
`)
    }
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const child = spawn("sh", ["-c", "exec " + command], {
      cwd: dir,
      env: { ...env, PATH: dirname(process.execPath) + ":" + process.env.PATH,
        RELEASE_WORKER_EVENTS: events, RELEASE_WORKER_FAILURE: failure ? "29" : "" },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"]
    })
    let output = ""
    child.stdout.setEncoding("utf8").on("data", text => { output += text })
    child.stderr.setEncoding("utf8").on("data", text => { output += text })
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("close", (code, signal) => resolve({ code, signal }))
    })
    let expired = false
    const guard = setTimeout(() => {
      expired = true
      try {
        if (process.platform === "win32") child.kill("SIGKILL")
        else process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if (error.code !== "ESRCH") throw error
      }
    }, 40_000)
    t.after(async () => {
      clearTimeout(guard)
      writeFileSync(join(events, "release"), "")
      await closed
      rmSync(dir, { recursive: true, force: true })
    })
    const started = () => readdirSync(events).filter(name => name.endsWith(".start")).length
    while (started() < 8 && child.exitCode === null && !expired) await delay(20)
    // Hold the first batch so an uncapped command can expose its extra workers.
    await delay(300)
    const peakBeforeRelease = started()
    writeFileSync(join(events, "release"), "")
    const result = await closed
    assert.equal(expired, false, output)
    assert.equal(result.signal, null, output)
    assert.equal(result.code, failure ? 1 : 0, output)
    assert.equal(started(), files.length, "every selected file ran")
    assert.equal(readdirSync(events).filter(name => name.endsWith(".end")).length, files.length,
      "every selected file completed")
    assert.equal(peakBeforeRelease, 8, "the release command must admit exactly eight file workers")
    if (failure) assert.match(output, /deliberate fixture failure/)
  })
}
