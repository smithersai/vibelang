// helpers/jj-config.mjs keeps the operator's jj configuration out of fixture
// repositories. A user config with snapshot.auto-track = "none" leaves every
// new fixture file untracked; with the helper imported, jj tracks it.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

const helper = new URL("./helpers/jj-config.mjs", import.meta.url).href

function trackedWith(useHelper) {
  const root = mkdtempSync(join(tmpdir(), "jj-config-"))
  try {
    const hostile = join(root, "operator.toml")
    writeFileSync(hostile, '[user]\nname = "operator"\nemail = "operator@localhost"\n[snapshot]\nauto-track = "none()"\n')
    const repo = join(root, "repo")
    const script = (useHelper ? `await import(${JSON.stringify(helper)})\n` : "") + `
      const { execFileSync } = await import("node:child_process")
      const { mkdirSync, writeFileSync } = await import("node:fs")
      mkdirSync(${JSON.stringify(repo)})
      execFileSync("jj", ["git", "init"], { cwd: ${JSON.stringify(repo)}, stdio: "ignore" })
      writeFileSync(${JSON.stringify(join(repo, "new.ts"))}, "export {}\\n")
      process.stdout.write(execFileSync("jj", ["file", "list"], { cwd: ${JSON.stringify(repo)}, encoding: "utf8" }))`
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, JJ_CONFIG: hostile } })
    assert.equal(run.status, 0, run.stderr)
    return run.stdout.trim().split("\n").filter(Boolean)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("the operator's jj configuration reaches a fixture without the helper", () => {
  assert.deepEqual(trackedWith(false), [])
})

test("with the helper, a fixture tracks new files whatever the operator configured", () => {
  assert.deepEqual(trackedWith(true), ["new.ts"])
})
