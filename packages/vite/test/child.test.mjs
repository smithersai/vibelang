import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:net"
import test from "node:test"
import { runChild } from "./child.mjs"

test("a child that never exits is killed at its limit and named", { timeout: 60_000 }, async (t) => {
  const server = createServer()
  const kill = process.kill.bind(process)
  let pid
  let socket
  t.after(() => {
    // Also clean up when the kill assertion fails.
    if (pid !== undefined) {
      try { kill(-pid, "SIGKILL") } catch {}
    }
    socket?.destroy()
    server.close()
  })
  await once(server.listen(0, "127.0.0.1"), "listening")
  const connection = once(server, "connection")
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const kills = t.mock.method(process, "kill", kill)
  const script = `
const { connect } = require("node:net")
connect(${server.address().port}, "127.0.0.1", function () {
  this.write(String(process.pid))
})
setInterval(() => {}, 1000)
`
  const rejected = assert.rejects(runChild(process.execPath, ["-e", script], { limit: 1000 }), (error) => {
    assert.match(error.message, /did not exit within 1 s/)
    assert.match(error.message, new RegExp(`Still running:\n\\s*${pid}\\s+${pid}\\s`))
    return true
  })
  const [connected] = await connection
  socket = connected
  const [data] = await once(socket, "data")
  pid = Number(data.toString())
  const closed = once(socket, "close")
  socket.resume()

  // Child startup and host scheduling do not advance this deadline.
  t.mock.timers.tick(999)
  assert.equal(kills.mock.callCount(), 0)
  t.mock.timers.tick(1)
  await rejected
  assert.deepEqual(kills.mock.calls.map(({ arguments: args }) => args), [[-pid, "SIGKILL"]])
  await closed
})

test("a child that exits while its own child holds the output resolves, and that child is killed", { timeout: 60_000 }, async () => {
  // The holder inherits this connection, which ends when the holder dies. Its
  // process id can't show that: a killed orphan stays a zombie, and
  // process.kill(pid, 0) still finds it, until init gets round to reaping it.
  const server = createServer()
  await once(server.listen(0, "127.0.0.1"), "listening")
  const connection = once(server, "connection")
  const script = `
const { spawn } = require("node:child_process")
const { connect } = require("node:net")
const socket = connect(${server.address().port}, "127.0.0.1", () => {
  spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "inherit", "inherit", socket] })
  process.exit(3)
})
`
  const result = await runChild(process.execPath, ["-e", script], { limit: 30_000 })
  assert.equal(result.code, 3)
  const [held] = await connection
  held.resume()
  await once(held, "close")
  server.close()
})

test("a child that exits normally resolves with its code and output", async () => {
  const result = await runChild(process.execPath, ["-e", "console.log('out'); console.error('err'); process.exit(2)"])
  assert.deepEqual([result.code, result.stdout, result.stderr], [2, "out\n", "err\n"])
})

test("a test file that leaves a handle open still exits, and the handle is named", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = await mkdtemp(join(tmpdir(), "vite-leak-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "leak.test.mjs")
  await writeFile(file, `import { test } from "node:test"\ntest("leaves a timer", () => { setInterval(() => {}, 1000) })\n`)
  const report = new URL("./report-handles.mjs", import.meta.url).href
  // run.sh's flags. A child of a test file that inherits NODE_TEST_CONTEXT
  // refuses to run test files, so the child runs as run.sh's node does.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = await runChild(process.execPath, ["--test", "--test-force-exit", "--import", report, file], { limit: 60_000, env })
  assert.equal(result.code, 0)
  assert.match(result.output, /leak\.test\.mjs left handles open after its tests: Timeout/)
})

test("the handle report ignores standard streams and handles whose close callbacks just ran", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = await mkdtemp(join(tmpdir(), "vite-closed-handles-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "closed.test.mjs")
  await writeFile(file, `
import { test } from "node:test"
import { spawn } from "node:child_process"
test("uses stdin and closes a child", async () => {
  void process.stdin
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""])
    child.on("error", reject)
    child.on("close", resolve)
  })
})
`)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const report = new URL("./report-handles.mjs", import.meta.url).href
  const result = await runChild(process.execPath, ["--test", "--test-force-exit", "--import", report, file], { env })
  assert.equal(result.code, 0, result.output)
  assert.doesNotMatch(result.output, /left handles open/, result.output)
})
