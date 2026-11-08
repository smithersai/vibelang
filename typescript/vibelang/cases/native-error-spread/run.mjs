// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/native-probe")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
for (const name of ["main.vibe", "package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, name), path.join(work, name))
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
const source = path.join(work, "main.vibe")
const original = fs.readFileSync(source, "utf8")
function command(stage, args) {
  const r = spawnSync(compiler, ["-p", ".", "--pretty", "false", ...args], { cwd: work, encoding: "utf8", timeout: 30000 })
  const output = (r.stdout || "") + (r.stderr || "")
  fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({ stage, status: r.status, signal: r.signal, error: r.error?.message, output }, null, 2))
  assert.equal(r.status, 0, stage + "\n" + output)
  return output
}
const before = command("check", ["--noEmit"])
assert.doesNotMatch(before, /EK483[07]/, "native Effect class must have no error-declaration advisory")
process.stdout.write("native Effect classes preserved\n")
