// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/migration")
fs.mkdirSync(work, { recursive: true })
for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, name), path.join(work, name))
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
fs.writeFileSync(path.join(work, "main.vibe"), `
export error Failure { mutable value: number }
export effect function main() {
  const subject = { _tag: "Failure", value: 8 } as unknown as Failure
  return match (subject) { when Failure(let found): found.value; default: -1; }
}
`)
function command(stage, bin, args) {
  const result = spawnSync(bin, args, { cwd: work, encoding: "utf8", timeout: 60_000 })
  fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({
    status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr
  }, null, 2))
  assert.equal(result.status, 0, `${stage}: ${result.stdout}${result.stderr}`)
  return result.stdout
}
const args = ["-p", ".", "--pretty", "false"]
const run = ["--input-type=module", "-e", `import { Effect } from "effect"; import { main } from "./out/main.js"; process.stdout.write(JSON.stringify(await Effect.runPromiseExit(main())))`]
command("before", compiler, args)
const declaration = fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8")
const before = JSON.parse(command("run-before", process.execPath, run))
assert.equal(before._tag, "Success")
assert.equal(before.value, 8)
command("fix", compiler, [...args, "--fix"])
assert.equal(fs.readFileSync(path.join(work, "out/main.d.ts"), "utf8"), declaration)
assert.deepEqual(JSON.parse(command("run-after", process.execPath, run)), before)
const fixed = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
assert.doesNotMatch(fixed, /mutable value/)
command("fix-again", compiler, [...args, "--fix"])
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), fixed)
process.stdout.write("mutable error migration preserves tag matching\n")
