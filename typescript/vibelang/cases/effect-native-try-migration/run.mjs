import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"

// run-seconds: 120
const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const legacy = fs.readFileSync(path.join(dir, "legacy.txt"), "utf8")
for (const vipOnly of [false, true]) {
  const work = path.join(dir, "out", vipOnly ? "vip-fix" : "plain-fix")
  fs.mkdirSync(work, { recursive: true })
  fs.writeFileSync(path.join(work, "main.vibe"), legacy)
  fs.writeFileSync(path.join(work, "package.json"), '{"type":"module"}')
  fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", skipLibCheck: true, types: [], outDir: "out" },
    files: ["main.vibe"],
  }))
  const run = (stage, args) => {
    const r = spawnSync(compiler, ["-p", work, "--pretty", "false", ...args], { encoding: "utf8", timeout: 30000 })
    fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message }, null, 2))
    return r
  }
  const rejected = run("before", ["--noEmit"])
  assert.notEqual(rejected.status, 0)
  assert.match(rejected.stdout + rejected.stderr, /EK0503/)
  const flags = ["--fix", ...(vipOnly ? ["--fix-vip-only"] : [])]
  const fixed = run("fixed", flags)
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  const text = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
  assert.match(text, /try \{ return 3 \} finally \{\}/)
  const output = await import(pathToFileURL(path.join(work, "out/main.js")))
  assert.deepEqual(await Effect.runPromise(output.main()), [[1], [2], 1, ["cleanup", "caught", "cleanup", "loop0", "loop1", "loop2", "fallback"], 3, 6, 9])
  const again = run("again", flags)
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), text)
}
console.log("native try migration preserves results and cleanup")
