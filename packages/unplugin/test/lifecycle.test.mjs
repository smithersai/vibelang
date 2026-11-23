import { unplugin } from "../src/index.js"
import { lifecycleTests } from "../../compiler/test/bundler-lifecycle.mjs"
lifecycleTests(options => unplugin.raw(options, { framework: "rollup" }))

import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

test("a CommonJS config can load vibelang-unplugin and its bundler subpaths", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-unplugin-cjs-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.url))), join(root, "node_modules/vibelang-unplugin"), "dir")
    writeFileSync(join(root, "config.cjs"), [
      'for (const id of ["vibelang-unplugin", "vibelang-unplugin/webpack", "vibelang-unplugin/rspack", "vibelang-unplugin/rollup", "vibelang-unplugin/rolldown", "vibelang-unplugin/esbuild", "vibelang-unplugin/bun", "vibelang-unplugin/vite", "vibelang-unplugin/deferred"]) {',
      '  const mod = require(id)',
      '  if (!mod || (typeof mod.default !== "function" && typeof mod.unplugin !== "object" && typeof mod.createDeferredPlugin !== "function")) throw new Error("unexpected export from " + id)',
      '}',
      'console.log("ok")',
      ""
    ].join("\n"))
    const result = spawnSync(process.execPath, ["config.cjs"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "ok")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("unplugin resolves extensionless .vibex imports", async (t) => {
  const { mkdtemp, rm, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { default: unplugin } = await import("../src/index.js")
  const root = await mkdtemp(join(tmpdir(), "vibelang-unplugin-vibex-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "App.vibex"), "export const App = () => <div/>\n")
  await writeFile(join(root, "main.vibe"), 'import { App } from "./App"\nexport { App }\n')
  const plugin = unplugin.raw({}, { framework: "rollup" })
  assert.equal(plugin.resolveId.call({}, "./App", join(root, "main.vibe")), join(root, "App.vibex"))
})
