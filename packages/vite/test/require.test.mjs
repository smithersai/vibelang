import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// Vite loads a config in a package without "type": "module" as CommonJS.
test("a CommonJS config can load vibelang-vite", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-vite-"))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(dirname(fileURLToPath(import.meta.url))), join(root, "node_modules/vibelang-vite"), "dir")
    writeFileSync(join(root, "config.cjs"), 'console.log(typeof require("vibelang-vite").default)\n')
    const result = spawnSync(process.execPath, ["config.cjs"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "function")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
