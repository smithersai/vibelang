import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"

const stalled = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// A busy parent reads late. Output the fake still has queued when it exits is lost, and
// a short list reads as a smaller project, which changes how the code under test shards it.
test("the fake compiler lists a whole project to a parent that reads late", async () => {
  const root = mkdtempSync(join(tmpdir(), "fake-project-files-"))
  try {
    mkdirSync(join(root, "src"))
    const count = 2000
    for (let i = 0; i < count; i++) writeFileSync(join(root, "src", `m${i}.vibe`), "")
    const compiler = join(root, "compiler.cjs")
    writeFileSync(compiler, fakeProjectFiles(root) + 'throw new Error("not a scope query")\n')
    const child = spawn(process.execPath, [compiler, "--listFilesOnly"], { stdio: ["ignore", "pipe", "inherit"] })
    stalled(1500)
    let stdout = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    const code = await new Promise((resolve) => child.on("close", resolve))
    assert.equal(code, 0)
    assert.equal(stdout.trim().split("\n").length, count)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
