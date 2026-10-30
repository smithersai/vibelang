// Shared teardown contract for the two bundler plugins. No native build is needed.
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { test } from "node:test"

export function lifecycleTests(create) {
  for (const mode of ["finishes", "ignores termination", "leaves inherited pipes"]) {
    for (const hook of ["closeBundle", "closeWatcher"]) {
      test(`${hook} waits for a compiler that ${mode} and releases its process and pipes`, async (t) => {
        const root = await mkdtemp(join(tmpdir(), "vibelang-lifecycle-"))
        const compiler = join(root, "compiler.mjs")
        const ready = join(root, "ready")
        const source = join(root, "main.vibe")
        await writeFile(join(root, "tsconfig.json"), '{"files":["main.vibe"]}')
        await writeFile(source, "export const answer = 42\n")
        // The stub need not emit: a normal exit is still a successful process
        // completion, while the plugin reports the missing module to its caller.
        await writeFile(compiler, `
import { writeFileSync } from "node:fs"
writeFileSync(${JSON.stringify(ready)}, String(process.pid))
${mode === "finishes" ? 'setTimeout(() => process.exit(0), 200)' : mode === "ignores termination"
  ? 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
  : `import { spawn } from "node:child_process"
const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" })
writeFileSync(${JSON.stringify(join(root, "holder"))}, String(holder.pid))
setInterval(() => {}, 1000)` }
`)
        const plugin = create({ root, compiler })
        plugin.configResolved?.({ root, logger: { warn() {} } })
        const context = { addWatchFile() {}, warn() {}, error(error) { throw new Error(error.message) } }
        let pending, child
        t.after(async () => {
          child ??= process._getActiveHandles().find(handle => handle.spawnargs?.includes(compiler))
          child?.kill("SIGKILL")
          child?.stdout.destroy()
          child?.stderr.destroy()
          try { process.kill(Number(await readFile(join(root, "holder"), "utf8")), "SIGKILL") } catch (error) {
            if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error
          }
          await pending
          await rm(root, { recursive: true, force: true })
        })
        pending = (plugin.transform
          ? plugin.transform.call(context, "", source)
          : plugin.load.call(context, source)).then(value => ({ value }), error => ({ error }))
        const deadline = Date.now() + 10000
        let pid
        while (!pid && Date.now() < deadline) {
          try { pid = Number(await readFile(ready, "utf8")) } catch {}
          if (!pid) await delay(10)
        }
        assert.ok(pid, "the compile started")
        child = process._getActiveHandles().find(handle => handle.pid === pid)
        assert.ok(child, "the test owns the compiler child")
        const started = Date.now()
        await plugin[hook]?.()
        assert.ok(Date.now() - started < 5000, "teardown is bounded")
        assert.ok(child.exitCode !== null || child.signalCode !== null, "teardown waited for the compiler to exit")
        assert.ok(child.stdout.destroyed && child.stderr.destroyed, "both compiler pipes are closed")
        const handles = process._getActiveHandles()
        assert.ok(!handles.includes(child) && !handles.includes(child.stdout) && !handles.includes(child.stderr),
          "no compiler process or pipe handle remains")
        if (mode === "finishes") assert.equal(child.exitCode, 0, "a short compile finishes during the grace period")
        await pending
        await plugin[hook]?.() // Repeated teardown is harmless.
      })
    }
  }

  test("closeBundle during backend initialization cannot leave a compiler running", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-lifecycle-init-"))
    const compiler = join(root, "compiler.mjs")
    await writeFile(compiler, 'setTimeout(() => process.exit(0), 100)')
    await writeFile(join(root, "tsconfig.json"), '{"files":["main.vibe"]}')
    await writeFile(join(root, "main.vibe"), "export const answer = 42\n")
    const plugin = create({ root, compiler })
    plugin.configResolved?.({ root, logger: { warn() {} } })
    const context = { addWatchFile() {}, error(error) { throw new Error(error.message) } }
    let settled = false
    const pending = (plugin.transform
      ? plugin.transform.call(context, "", join(root, "main.vibe"))
      : plugin.load.call(context, join(root, "main.vibe"))).catch(() => {}).finally(() => { settled = true })
    t.after(async () => {
      await pending
      await plugin.closeBundle?.()
      await rm(root, { recursive: true, force: true })
    })
    await plugin.closeBundle?.()
    assert.ok(settled, "teardown also waits for backend initialization and its pending load")
    assert.equal(process._getActiveHandles().filter(handle => handle.spawnargs?.includes(compiler) && handle.exitCode === null).length, 0)
    await pending
    await plugin.closeBundle?.()
  })
  test("a plugin reused after closeBundle compiles with a fresh backend", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-lifecycle-reuse-"))
    const compiler = join(root, "compiler.mjs")
    const source = join(root, "main.vibe")
    const calls = join(root, "calls")
    await writeFile(join(root, "tsconfig.json"), '{"files":["main.vibe"]}')
    await writeFile(compiler, `
import { appendFileSync } from "node:fs"
appendFileSync(${JSON.stringify(calls)}, "compile\\n")
console.log(${JSON.stringify(source)})
`)
    const plugin = create({ root, compiler })
    plugin.configResolved?.({ root, logger: { warn() {} } })
    t.after(async () => { await plugin.closeBundle(); await rm(root, { recursive: true, force: true }) })
    const context = { addWatchFile() {}, error(error) { throw new Error(error.message) } }
    for (const value of [42, 43]) {
      await writeFile(source, `export const answer = ${value}\n`)
      // The stub deliberately emits no module, so each load reports that error.
      await (plugin.transform
        ? plugin.transform.call(context, "", source)
        : plugin.load.call(context, source)).catch(() => {})
      await Promise.all([plugin.closeBundle(), plugin.closeWatcher()])
    }
    assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 2)
  })

}
