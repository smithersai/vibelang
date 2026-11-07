// run-seconds: 240 (four bounded 60-second compiler calls)
// Runs vibelang --fix on a copy of main.vibe: first with EK4833 off, so only
// EK4856 repairs, then with the default severities. The declaration file
// never changes, the refused types keep their text, and a second run is a no-op.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const work = path.join(dir, "out", "fix")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"), "dir")
const source = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
fs.writeFileSync(path.join(work, "main.vibe"), source)
const config = vibe => JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true, outDir: "build", types: [] }, ...(vibe ? { vibe } : {}), files: ["main.vibe"] })
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const tsc = (...args) => {
  const result = spawnSync(compiler, ["-p", work, "--pretty", "false", ...args], { encoding: "utf8", timeout: 60_000 })
  if (result.error) throw result.error
  return result.stdout + result.stderr
}
const declarations = () => fs.readFileSync(path.join(work, "build", "main.d.ts"), "utf8")
const line = name => fs.readFileSync(path.join(work, "main.vibe"), "utf8").split("\n").find(l => l.startsWith("export type " + name + " "))

fs.writeFileSync(path.join(work, "tsconfig.json"), config({ severities: { EK4833: "off" } }))
tsc()
const before = declarations()
assert.match(tsc("--fix"), /EK4856 ×1/)
assert.equal(line("Legacy"), "export type Legacy = Effect.Effect<number | string>")
assert.equal(line("Union"), "export type Union = Effect.Effect<number | string>")

fs.writeFileSync(path.join(work, "tsconfig.json"), config())
const fixed = tsc("--fix")
assert.match(fixed, /declaration emission would remove the source-written parentheses/)
assert.match(fixed, /discard or reorder comments between its type arguments/)
assert.equal(line("Union"), "export type Union = (number | string)!!")
assert.equal(line("List"), "export type List = (number!!)[]")
assert.equal(line("Legacy"), "export type Legacy = (number | string)!!")
assert.equal(line("Paren"), "export type Paren = Effect.Effect<(number | string)>")
assert.equal(line("Commented"), "export type Commented = Effect.Effect</* success */ number, Error>")
tsc()
assert.equal(declarations(), before, "the grouped shorthand changed declaration output")
assert.match(tsc("--fix"), /0 fixes in 0 files/)
console.log("grouped shorthand, refusals and the EK4856 sequence keep declarations")
