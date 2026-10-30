import vibelang from "../src/index.js"
import { lifecycleTests } from "../../compiler/test/bundler-lifecycle.mjs"

import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { createServer } from "vite"

lifecycleTests(vibelang)

for (const action of ["close", "restart"]) {
  test(`Vite server ${action} waits for an active compiler and closes its pipes`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-vite-server-close-"))
    const compiler = join(root, "compiler.mjs")
    const ready = join(root, "ready")
    await writeFile(join(root, "tsconfig.json"), '{"files":["main.vibe"]}')
    await writeFile(join(root, "main.vibe"), "export const answer = 42\n")
    await writeFile(compiler, `
import { writeFileSync } from "node:fs"
process.on("SIGTERM", () => {})
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
setInterval(() => {}, 1000)
`)
    const server = await createServer({
      root, configFile: false, logLevel: "silent", plugins: [vibelang({ compiler })],
      server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true }
    })
    let child, pending
    t.after(async () => {
      child ??= process._getActiveHandles().find(handle => handle.spawnargs?.includes(compiler))
      child?.kill("SIGKILL")
      child?.stdout.destroy()
      child?.stderr.destroy()
      let timer
      try {
        await Promise.race([
          Promise.allSettled([pending, server.close()]),
          new Promise(resolve => { timer = setTimeout(resolve, 1000) })
        ])
      } finally { clearTimeout(timer) }
      await rm(root, { recursive: true, force: true })
    })
    pending = server.transformRequest("/main.vibe").catch(() => {})
    const deadline = Date.now() + 10000
    let pid
    while (!pid && Date.now() < deadline) {
      try { pid = Number(await readFile(ready, "utf8")) } catch {}
      if (!pid) await delay(10)
    }
    assert.ok(pid, "the server started its compiler")
    child = process._getActiveHandles().find(handle => handle.pid === pid)
    assert.ok(child)
    let timer
    try {
      await Promise.race([
        server[action](),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`server.${action} waited on its compiler`)), 3000) })
      ])
    } finally { clearTimeout(timer) }
    await pending
    assert.ok(child.exitCode !== null || child.signalCode !== null)
    assert.ok(child.stdout.destroyed && child.stderr.destroyed)
    assert.ok(!process._getActiveHandles().includes(child))
  })
}
