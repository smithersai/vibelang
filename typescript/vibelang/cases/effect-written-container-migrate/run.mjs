// run-seconds: 240
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/migration")
fs.mkdirSync(work, { recursive: true })
fs.writeFileSync(path.join(work, "package.json"), '{"type":"module"}')
fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, skipLibCheck: true, declaration: true, outDir: "out" },
  files: ["main.vibe"],
}))
const source = [
  "let runs = 0",
  "export function count(): number { return runs }",
  'export const failure = new Error("bad")',
  "export effect function f(): unknown { runs += 1; return runs }",
  "export effect function g(): any { throw failure }",
  "",
].join("\n")
fs.writeFileSync(path.join(work, "main.vibe"), source)
function command(stage, ...flags) {
  const r = spawnSync(compiler, ["-p", work, "--pretty", "false", ...flags], { encoding: "utf8", timeout: 60000 })
  fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error?.message }, null, 2))
  return r
}
const before = command("before")
assert.equal(before.status, 2, before.stdout + before.stderr)
assert.equal((before.stdout.match(/error EK0106/g) || []).length, 2, before.stdout)
const fixed = command("fix", "--fix")
assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
const rewritten = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
assert.equal(rewritten, source.replace("f(): unknown", "f()").replace("g(): any", "g()"))
const second = command("again", "--fix")
assert.equal(second.status, 0, second.stdout + second.stderr)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), rewritten)
const output = await import(pathToFileURL(path.join(work, "out/main.js")))
const job = output.f()
assert.equal(output.count(), 0)
assert.equal(Effect.runSync(job), 1)
assert.equal(Effect.runSync(job), 2)
assert.equal(output.count(), 2)
assert.equal(Effect.runSync(Effect.flip(output.g())), output.failure)
console.log("cold=0 runs=1,2 failure=preserved fixes=idempotent")
