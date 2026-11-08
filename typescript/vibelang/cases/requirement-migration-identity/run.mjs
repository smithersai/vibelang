// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/fix-evidence")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
for (const name of ["dep.ts", "other.ts", "namespaced.ts", "tsconfig.json"]) fs.copyFileSync(path.join(dir, name), path.join(work, name))
const wanted = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
const before = wanted.replaceAll(/number!never!(Renamed|D\.Input|\(Renamed \| Other\))/g, "number!never")
assert.notEqual(before, wanted)
fs.writeFileSync(path.join(work, "main.vibe"), before)
function fix(stage) {
  const result = spawnSync(compiler, ["-p", work, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
fix("first")
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), wanted)
assert.equal(fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8"), fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8"))
assert.match(fix("second"), /0 fixes in 0 files/)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), wanted)
console.log("requirements preserved")
