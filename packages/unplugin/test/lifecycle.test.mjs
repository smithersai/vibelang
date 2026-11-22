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
