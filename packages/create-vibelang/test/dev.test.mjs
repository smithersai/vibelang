import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"

const source = process.env.DEV_TEMPLATE || new URL("../../../templates/app/scripts/dev.mjs", import.meta.url)

async function editAfterFirstOutput({ delay = 1000, split = 12, color = false } = {}) {
 const root = mkdtempSync(join(tmpdir(), "starter-dev-"))
 mkdirSync(join(root, "scripts"))
 mkdirSync(join(root, "bin"))
 writeFileSync(join(root, "package.json"), '{"type":"module"}')
 writeFileSync(join(root, "scripts/dev.mjs"), readFileSync(source))
 writeFileSync(join(root, "source.txt"), "BEFORE")
 writeFileSync(join(root, "bin/package.json"), '{"type":"commonjs"}')
 const ready = (color ? "\x1b[32m" : "") + "Found 0 errors. Watching for file changes." + (color ? "\x1b[0m" : "") + "\n"
 const compiler = `#!${process.execPath}
const fs = require("node:fs")
fs.mkdirSync("dist", {recursive:true})
const emit = value => fs.writeFileSync("dist/main.js", "console.log(" + JSON.stringify(value) + ")")
const initial = fs.readFileSync("source.txt", "utf8")
if (!process.argv.includes("--watch")) emit(initial)
else setTimeout(() => {
 fs.watchFile("source.txt", {interval:10}, () => emit(fs.readFileSync("source.txt", "utf8")))
 emit(initial)
 const ready = ${JSON.stringify(ready)}
 process.stdout.write(ready.slice(0, ${split}))
 setTimeout(() => process.stdout.write(ready.slice(${split})), 5)
}, ${delay})
`
 writeFileSync(join(root, "bin/vibelang"), compiler)
 chmodSync(join(root, "bin/vibelang"), 0o755)
 const child = spawn(process.execPath, ["scripts/dev.mjs"], {
  cwd: root, detached: true, env: { ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH },
  stdio: ["ignore", "pipe", "pipe"]
 })
 let output = "", edited = false
 const consume = data => {
  output += data
  if (!edited && output.includes("BEFORE")) {
   edited = true
   writeFileSync(join(root, "source.txt"), "AFTER")
  }
 }
 child.stdout.on("data", consume)
 child.stderr.on("data", consume)
 try {
  const deadline = Date.now() + 5000
  while (!output.includes("AFTER") && child.exitCode === null && Date.now() < deadline) {
   await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(output.includes("AFTER"), "the first edit was lost:\n" + output)
 } finally {
  try { process.kill(-child.pid, "SIGTERM") } catch {}
  await new Promise(resolve => setTimeout(resolve, 50))
  try { process.kill(-child.pid, "SIGKILL") } catch {}
  rmSync(root, { recursive: true, force: true })
 }
}

test("an edit after the first output reaches an already active compiler watcher", { timeout: 10000 }, async () => {
 await editAfterFirstOutput()
})

test("readiness survives split and colored watch output", { timeout: 30000 }, async () => {
 await fc.assert(fc.asyncProperty(
  fc.integer({ min: 100, max: 300 }),
  fc.integer({ min: 1, max: 45 }),
  fc.boolean(),
  async (delay, split, color) => editAfterFirstOutput({ delay, split, color })
 ), { seed: 610326, numRuns: 5, endOnFailure: true })
})
