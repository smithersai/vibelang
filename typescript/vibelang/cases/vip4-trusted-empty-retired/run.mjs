// run-seconds: 180 (three bounded 60-second compiler calls)
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
fs.copyFileSync(path.join(dir, "helpers.ts"), path.join(work, "helpers.ts"))
fs.writeFileSync(path.join(work, "main.vibe"), fs.readFileSync(path.join(dir, "legacy.vibe.txt"), "utf8"))
fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "build", types: [], rewriteRelativeImportExtensions: true }, files: ["main.vibe", "helpers.ts"] }))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const tsc = (...args) => {
  const result = spawnSync(compiler, ["-p", work, "--pretty", "false", ...args], { encoding: "utf8", timeout: 60_000 })
  if (result.error) throw result.error
  return { status: result.status, output: result.stdout + result.stderr }
}
const before = tsc("--noEmit")
assert.match(before.output, /error EK0407:[^\n]*vibelang --fix/, before.output)
const fixed = tsc("--fix")
const text = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
assert.doesNotMatch(text, /trusted\(/, text)
assert.match(text, /Effect\.orDie\(Effect\.try\(\{ try: \(\) => [^}]*, catch: \(e\) => e \}\)\)/, text)
assert.doesNotMatch(text, /\bidentity\b/, text)
assert.equal(fixed.status, 0, fixed.output)
const program = await import(pathToFileURL(path.join(work, "build", "main.js")).href)
assert.equal(await Effect.runPromise(program.main()), 3)
console.log("trusted(f, []) migrates to the identity-mapped bridge")
