import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
    const compiler = join(root, "compiler.cjs"), writing = join(root, "writing")
    // The child marks the start of its list write, so the parent's late read is
    // measured from there rather than from however long the child took to start.
    const marker = `const markerFs = require("node:fs"), markerWrite = markerFs.writeSync, markerStdout = process.stdout.write.bind(process.stdout)
const markWriting = () => markerFs.writeFileSync(${JSON.stringify(writing)}, "")
markerFs.writeSync = (fd, ...rest) => { if (fd === 1) markWriting(); return markerWrite(fd, ...rest) }
process.stdout.write = (...rest) => { markWriting(); return markerStdout(...rest) }\n`
    writeFileSync(compiler, marker + fakeProjectFiles(root) + 'throw new Error("not a scope query")\n')
    const child = spawn(process.execPath, [compiler, "--listFilesOnly"], { stdio: ["ignore", "pipe", "inherit"] })
    for (let i = 0; i < 6000 && !existsSync(writing); i++) stalled(10)
    assert.ok(existsSync(writing), "the fake compiler never started its list")
    stalled(1500)
    let stdout = ""
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk })
    const code = await new Promise((resolve) => child.on("close", resolve))
    assert.equal(code, 0)
    assert.equal(stdout.trim().split("\n").length, count)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
