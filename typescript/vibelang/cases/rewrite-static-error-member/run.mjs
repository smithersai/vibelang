import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/migration-evidence")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
for (const name of ["package.json", "tsconfig.json"]) fs.copyFileSync(path.join(dir, name), path.join(work, name))
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
const source = path.join(work, "main.vibe")
fs.writeFileSync(source, `export error E { id: string; static meta = "metadata" }
export const program = effect {
  const other = { _tag: "E" as const, id: "copy" }
  return match (other) { when E: "match"; default: "miss"; }
}
`)
function command(stage, bin, args) {
  const result = spawnSync(bin, args, { cwd: work, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
  fs.writeFileSync(path.join(work, stage + ".json"), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2))
  assert.equal(result.status, 0, stage + "\n" + result.stdout + result.stderr)
  return result.stdout
}
command("fix", compiler, ["-p", ".", "--fix", "--pretty", "false"])
const fixed = fs.readFileSync(source, "utf8")
assert.ok(fixed.includes("class E extends"), "the static member was not migrated to its explicit class")
assert.ok(!fixed.includes("export error E"), "the rejected declaration remains")
const output = command("match", process.execPath, ["--input-type=module", "-e", `import { Effect } from "effect";
import { program } from "./out/main.js";
process.stdout.write(JSON.stringify(await Effect.runPromiseExit(program)));
`])
assert.equal(JSON.parse(output)._tag, "Success")
assert.equal(JSON.parse(output).value, "match", "migration lost matching across copies")
command("fix-again", compiler, ["-p", ".", "--fix", "--pretty", "false"])
assert.equal(fs.readFileSync(source, "utf8"), fixed, "the second fix changed the source")
process.stdout.write("static error member migration preserves match\n")
