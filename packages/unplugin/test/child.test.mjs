import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:net"
import test from "node:test"
import { spawn } from "node:child_process"
import { runChild, stopGroup } from "./child.mjs"

test("a child that never exits is killed at its limit and named", async () => {
  const started = Date.now()
  await assert.rejects(runChild(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], { limit: 1000 }),
    (error) => /did not exit within 1 s/.test(error.message) && /Still running:/.test(error.message) && /ready/.test(error.message))
  assert.ok(Date.now() - started < 10_000)
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

test("stopGroup stops a parent that replaces its child as it dies", { timeout: 20_000 }, async () => {
  // Each holder inherits the output, and "close" waits for every writer of it to
  // die. The parent starts a new holder the moment one exits, as a bundler starts
  // a new compile when one fails.
  const script = `
const { spawn } = require("node:child_process")
const start = () => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }).on("exit", start)
start()
console.log("ready")
`
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: ["ignore", "pipe", "inherit"] })
  await once(child.stdout, "data")
  child.stdout.resume()
  await stopGroup(child)
  assert.equal(child.signalCode, "SIGKILL")
})

test("stopGroup is safe on a child that has already exited", async () => {
  const child = spawn(process.execPath, ["-e", ""], { detached: true, stdio: "ignore" })
  await once(child, "close")
  await stopGroup(child)
})

test("a child that exits normally resolves with its code and output", async () => {
  const result = await runChild(process.execPath, ["-e", "console.log('out'); console.error('err'); process.exit(2)"])
  assert.deepEqual([result.code, result.stdout, result.stderr], [2, "out\n", "err\n"])
})
