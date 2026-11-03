import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

const dir = import.meta.dirname
const want = ["ReferenceError", "function", 7]
assert.deepEqual((await import("./out/main.js")).probe(), want)
assert.deepEqual((await import("./native.ts")).probe(), want)

const fixed = path.join(dir, "out", "fixed")
fs.mkdirSync(fixed, { recursive: true })
for (const file of ["main.vibe", "tsconfig.json", "package.json"]) {
  fs.copyFileSync(path.join(dir, file), path.join(fixed, file))
}
const compiler = path.resolve(dir, "../../../built/local/tsc")
const result = spawnSync(compiler, ["-p", fixed, "--fix"], { encoding: "utf8" })
assert.equal(result.status, 0, result.stdout + result.stderr)
const source = fs.readFileSync(path.join(fixed, "main.vibe"), "utf8")
const actual = (await import(pathToFileURL(path.join(fixed, "out/main.js")))).probe()
assert.deepEqual(actual, want, "the CLI fix must preserve the native TDZ")
assert.match(source, /export const main =/)
assert.doesNotMatch(source, /export function main\(/)
console.log(JSON.stringify(want))
