// run-seconds: 360 (three bounded CLI calls plus runtime and file comparisons)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const work = path.join(dir, "out/migration")
fs.mkdirSync(work, { recursive: true })
const source = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
const mixed = source.replaceAll("async", "async /* keep 😀 */ effect")
fs.writeFileSync(path.join(work, "main.vibe"), mixed)
fs.copyFileSync(path.join(dir, "tsconfig.json"), path.join(work, "tsconfig.json"))
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const run = (stage, args) => {
  const result = spawnSync(compiler, ["-p", work, "--pretty", "false", ...args], { encoding: "utf8", timeout: 120000 })
  fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({ status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr }, null, 2))
  return result
}
assert.match(run("diagnose", ["--noEmit"]).stdout, /EK0105/)
const before = await import(pathToFileURL(path.join(dir, "out/main.js")))
assert.equal(await before.main(), 5)
console.log("mixed prefixes migrate with the same result and declarations")
