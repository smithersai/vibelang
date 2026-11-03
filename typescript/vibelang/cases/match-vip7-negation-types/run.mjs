// run-seconds: 300
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { Effect } from "effect"

const here = dirname(fileURLToPath(import.meta.url))
const cache = resolve(here, "../../../.cache/match-vip7-reference")
const versions = { typescript: "5.9.3", effect: "4.1.0" }
const installed = name => {
  try { return JSON.parse(readFileSync(resolve(cache, "node_modules", name, "package.json"))).version === versions[name] }
  catch { return false }
}
const run = (command, args) => {
  const child = spawnSync(command, args, { cwd: here, encoding: "utf8", timeout: 240000 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, `${command}: ${child.stdout}\n${child.stderr}`)
}
if (!Object.keys(versions).every(installed)) {
  mkdirSync(cache, { recursive: true })
  writeFileSync(resolve(cache, "package.json"), JSON.stringify({ private: true, type: "module" }))
  run("npm", ["install", "--prefix", cache, "--ignore-scripts", "--no-audit", "--no-fund", "typescript@5.9.3", "effect@4.1.0"])
}
for (const name of Object.keys(versions)) assert.ok(installed(name), `missing pinned ${name}`)
mkdirSync(resolve(here, "typescript/node_modules"), { recursive: true })
rmSync(resolve(here, "typescript/node_modules/effect"), { recursive: true, force: true })
symlinkSync(resolve(cache, "node_modules/effect"), resolve(here, "typescript/node_modules/effect"), "dir")
run(process.execPath, [resolve(cache, "node_modules/typescript/bin/tsc"), "-p", "typescript/tsconfig.json"])
assert.equal(readFileSync(resolve(here, "typescript/out/main.d.ts"), "utf8"), readFileSync(resolve(here, "out/main.d.ts"), "utf8"))
const actual = await import("./out/main.js")
const reference = await import("./typescript/out/main.js")
const requireReference = createRequire(resolve(cache, "package.json"))
const referenceEffect = await import(pathToFileURL(requireReference.resolve("effect/Effect")))
const serial = value => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (item instanceof Error) return { name: item.name, message: item.message, ...(item instanceof AggregateError ? { errors: item.errors } : {}) }
  if (item === undefined) return { $undefined: true }
  if (typeof item === "bigint") return { $bigint: String(item) }
  if (typeof item === "number" && !Number.isFinite(item)) return { $number: String(item) }
  return item
}))
const actualExit = serial(Effect.runSyncExit(actual.main()))
const referenceExit = serial(referenceEffect.runSyncExit(reference.main()))
assert.deepEqual(actualExit, referenceExit)
assert.equal(actualExit._tag, "Success")
console.log("ok pinned TypeScript 5.9.3 / Effect 4.1.0 negation follows actual tests types and Exit")
