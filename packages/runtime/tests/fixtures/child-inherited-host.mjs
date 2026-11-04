import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as ChildProcess from "../../dist/experimental/ChildProcess.js"
import { ExperimentalNodeChildProcess } from "../../dist/experimental/platform-node/index.js"
import { ExperimentalBunChildProcess } from "../../dist/experimental/platform-bun/index.js"
const layer = process.versions.bun ? ExperimentalBunChildProcess.layer : ExperimentalNodeChildProcess.layer
const service = await Effect.runPromise(Effect.provide(ChildProcess.ChildProcess, layer))
const code = await Effect.runPromise(service.runInherited(process.execPath, ["-e", "process.exit(0)"], { cwd: process.cwd() }))
assert.equal(code, 0)
const failed = await Effect.runPromise(Effect.match(service.runInherited("/test/vibelang-nonexistent-child-executable", [], { cwd: process.cwd() }), { onFailure: error => error instanceof Error, onSuccess: () => false }))
assert.equal(failed, true)
const dir = mkdtempSync(join(tmpdir(), "vibelang-child-owner-"))
const ready = join(dir, "ready"), release = join(dir, "release"), signaled = join(dir, "signaled")
let child
const observed = ChildProcess.make({ spawn(command, args, options) { child = spawn(command, [...args], options); return child } })
const childSource = [
  "const fs=require('node:fs')",
  "process.on('SIGTERM',()=>fs.writeFileSync(" + JSON.stringify(signaled) + ",'term'))",
  "fs.writeFileSync(" + JSON.stringify(ready) + ",'ready')",
  "setInterval(()=>{if(fs.existsSync(" + JSON.stringify(release) + "))process.exit(0)},5)"
].join(";")
const fiber = Effect.runFork(observed.runInherited(process.execPath, ["-e", childSource], { cwd: dir }))
const waitFor = async (predicate) => {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "bounded native child lifecycle deadline")
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
try {
  await waitFor(() => existsSync(ready))
  const exited = once(child, "exit")
  await Promise.race([
    Effect.runPromise(Fiber.interrupt(fiber)),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("child cancellation waited for exit")), 10000); timer.unref() })
  ])
  assert.equal(child.exitCode, null)
  assert.equal(child.killed, true)
  await waitFor(() => existsSync(signaled))
  writeFileSync(release, "release")
  await exited
  console.log("CHILD-INHERITED " + JSON.stringify({ host: process.versions.bun ? "bun" : "node", code, nativeError: failed, canceledBeforeExit: true, defaultTermObserved: true }))
} finally {
  writeFileSync(release, "release")
  if (child && child.exitCode === null && child.signalCode === null) {
    const closed = once(child, "close").catch(() => {})
    child.kill("SIGKILL")
    await closed
  }
  rmSync(dir, { recursive: true, force: true })
}
