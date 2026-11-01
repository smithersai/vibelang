import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

// Bun ignores a timeout key in bunfig.toml, so the kernel laws ran at its 5 s
// default while their configuration said 30 s, and a loaded host failed them.
test("the kernel suite's preload outlasts Bun's five-second default", () => {
  const dir = mkdtempSync(join(tmpdir(), "kernel-budget-"))
  try {
    const preload = fileURLToPath(new URL("../experiments/scripts/test-watchdog.ts", import.meta.url))
    writeFileSync(join(dir, "bunfig.toml"), `[test]\npreload = [${JSON.stringify(preload)}]\n`)
    writeFileSync(join(dir, "slow.test.ts"), 'import { test } from "bun:test"\ntest("slow", async () => { await Bun.sleep(5_200) })\n')
    const result = spawnSync("bun", ["test"], { cwd: dir, encoding: "utf8", timeout: 20_000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
