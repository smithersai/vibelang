import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/fix-evidence")
fs.rmSync(work, { recursive: true, force: true })
fs.cpSync(path.join(dir, "input"), work, { recursive: true })
function command(stage) {
  const result = spawnSync(compiler, ["-p", work, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
  fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
command("fix")
const fixed = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
assert.equal(fixed, fs.readFileSync(path.join(work, "fixed.txt"), "utf8"))
assert(!fs.readFileSync(path.join(work, "out/main.js"), "utf8").includes("node:"))
const output = await import(pathToFileURL(path.join(work, "out/main.js")))
assert.equal(output.n, 42)
assert.match(command("fix-again"), /0 fixes in 0 files/)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), fixed)
console.log("fixed")
