// Shared contract for the two bundler plugins when no vibelang package can be
// resolved, from the project's root or from beside the plugin. No native build
// is needed: the plugin fails before it would look for a compiler.
import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"

/**
 * packageDir is the plugin package; dependencies are the bare packages its
 * src imports. entry loads the copied src/index.js's module and returns the
 * plugin for options; message is the error a load must report.
 */
export function missingBackendTests({ packageDir, dependencies, entry, message }) {
  function isolated(t) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-plugin-no-backend-")))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const plugin = join(root, "plugin")
    cpSync(join(packageDir, "src"), join(plugin, "src"), { recursive: true })
    writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "plugin-copy", type: "module" }))
    for (const name of dependencies) {
      const target = join(plugin, "node_modules", name)
      mkdirSync(dirname(target), { recursive: true })
      symlinkSync(realpathSync(join(packageDir, "node_modules", name)), target, "dir")
    }
    const app = join(root, "app")
    mkdirSync(app)
    writeFileSync(join(app, "package.json"), '{"type":"module"}')
    writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [] }, include: ["*.vibe"] }))
    writeFileSync(join(app, "main.vibe"), "export const value = 1\n")
    return { app, module: pathToFileURL(join(plugin, "src/index.js")).href }
  }

  test("without a resolvable vibelang package a module load names the install, every time, and teardown finishes", async (t) => {
    const { app, module } = isolated(t)
    const plugin = await entry(module, { root: app })
    plugin.configResolved?.({ root: app, command: "build", logger: { warn() {} } })
    const context = { meta: { watchMode: false }, addWatchFile() {}, warn() {}, error(error) { throw error instanceof Error ? error : new Error(error.message ?? String(error)) } }
    // vibelang-unplugin loads its backend in buildStart, vibelang-vite on the
    // first module load. Either hook may be the one that reports it.
    const started = await Promise.resolve().then(() => plugin.buildStart?.call(context)).then(() => undefined, (error) => error)
    if (started !== undefined) assert.ok(String(started.message).includes(message), started.stack)
    const file = join(app, "main.vibe")
    await assert.rejects(Promise.resolve().then(() => plugin.load.call(context, file)), (error) => {
      assert.ok(String(error.message).includes(message), error.stack)
      return true
    })
    // A later load reports the same failure instead of hanging or failing on
    // the half-loaded state.
    await assert.rejects(Promise.resolve().then(() => plugin.load.call(context, file)), (error) => String(error.message).includes(message))
    await plugin.buildEnd?.call(context)
    await plugin.closeBundle?.call(context)
  })
}
