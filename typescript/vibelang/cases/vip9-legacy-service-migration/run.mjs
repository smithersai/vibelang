// run-seconds: 240 (four bounded 60-second compiler calls)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"

const dir = path.dirname(fileURLToPath(import.meta.url))
const work = path.join(dir, "out", "legacy")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"), "dir")
fs.writeFileSync(path.join(work, "package.json"), JSON.stringify({ name: "vip9-legacy", type: "module", private: true }))
fs.writeFileSync(path.join(work, "main.vibe"), fs.readFileSync(path.join(dir, "legacy.vibe.txt"), "utf8"))
const config = outDir => JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir, types: [] }, files: ["main.vibe"] })
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const tsc = (...args) => {
  const result = spawnSync(compiler, ["-p", work, "--pretty", "false", ...args], { encoding: "utf8", timeout: 60_000 })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}
const observe = async outDir => {
  const m = await import(pathToFileURL(path.join(work, outDir, "main.js")).href)
  const flags = await Effect.runPromiseExit(m.readFlags())
  const fallback = await Effect.runPromiseExit(m.readFallback())
  return { same: m.same, key: m.key, cached: m.cached, flags: flags._tag, fallback: fallback._tag === "Success" ? fallback.value : fallback._tag }
}

fs.writeFileSync(path.join(work, "tsconfig.json"), config("before"))
const before = tsc()
assert.equal(before.status, 0, before.output)
assert.match(before.output, /warning EK4854/)
assert.match(before.output, /warning EK4855/)
const legacy = await observe("before")
assert.deepEqual(legacy, { same: true, key: "vip9/Flags", cached: { enabled: true }, flags: "Failure", fallback: false })

console.log("legacy services migrate with their key, cached default and missing-provider failure")
