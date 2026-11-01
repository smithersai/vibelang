import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { value } from "./out/main.js"

assert.equal(value, 7)
const here = path.dirname(fileURLToPath(import.meta.url))
const work = path.join(here, "out/fix-evidence")
fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const sources = [
  ["export type Basic = Effect<number>", "export type Basic = number!!"],
  ["export type Defaults = Effect<number, never, never>", "export type Defaults = number!never!never"],
  ["export type Union = Effect<number | string>", "export type Union = Effect.Effect<number | string>"],
  ["export type Items = Effect<number>[]", "export type Items = Effect.Effect<number>[]"],
  ["export type Member = Effect<number> | null", "export type Member = Effect.Effect<number> | null"],
  ["export type Group = (Effect<number>)[]", "export type Group = (Effect.Effect<number>)[]"],
  ["export type GroupSlot = Effect<(number | string)>", "export type GroupSlot = Effect.Effect<(number | string)>"],
  ["export interface Parent extends Effect<number> {}", "export interface Parent extends Effect.Effect<number> {}"],
]
const original = sources.map(([source]) => source).join("\n") + "\n"
const expected = sources.map(([, fixed]) => fixed).join("\n") + "\n"
fs.writeFileSync(path.join(work, "main.vibe"), original)
fs.writeFileSync(path.join(work, "package.json"), '{"type":"module"}\n')
fs.writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({
  compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "out" },
  files: ["main.vibe"],
}) + "\n")
function command(stage, fix = false) {
  const args = ["-p", work, "--pretty", "false"]
  if (fix) args.push("--fix")
  const result = spawnSync(compiler, args, { encoding: "utf8", timeout: 30000 })
  fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message }, null, 2))
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
command("before")
const declaration = fs.readFileSync(path.join(work, "out/main.d.ts"))
command("fix", true)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), expected)
assert.deepEqual(fs.readFileSync(path.join(work, "out/main.d.ts")), declaration)
assert.match(command("again", true), /0 fixes in 0 files/)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), expected)
assert.deepEqual(fs.readFileSync(path.join(work, "out/main.d.ts")), declaration)
console.log("ok")
