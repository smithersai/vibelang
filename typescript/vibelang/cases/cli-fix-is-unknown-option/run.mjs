// run-seconds: 120
// VibeLang has no --fix option (ruling PROC-29): the command line answers it as
// TypeScript answers any unknown option, and no source file changes.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const dir = path.join(process.cwd(), "out/project")
fs.mkdirSync(dir, { recursive: true })
// A retired declaration form that the removed fixer used to rewrite.
const source = "export service class Users {}\n"
fs.writeFileSync(path.join(dir, "main.vibe"), source)
fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, skipLibCheck: true, noEmit: true, types: [] }, include: ["main.vibe"] }))
const compiler = process.env.VIBELANG_TEST_COMPILER || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
for (const flags of [["--fix"], ["--fix", "--fix-only", "main.vibe"], ["--fix-vip-only"]]) {
  const result = spawnSync(compiler, [...flags, "-p", dir, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.ifError(result.error)
  const output = result.stdout + result.stderr
  assert.match(output, new RegExp("error TS5023: Unknown compiler option '" + flags[0] + "'\\."), output)
  assert.notEqual(result.status, 0, output)
  assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), source)
}
console.log("--fix is an unknown option")
