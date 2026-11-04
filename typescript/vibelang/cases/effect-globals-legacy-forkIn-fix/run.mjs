// run-seconds: 300
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect } from "effect"

const here = dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? resolve(here, "../../../built/local/tsc")
const stock = resolve(here, "../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(JSON.parse(readFileSync(resolve(here, "../../../../experiments/node_modules/typescript/package.json"))).version, "5.9.3")
const dir = mkdtempSync(join(here, ".legacy-fork-"))
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  copyFileSync(join(here, "events.ts"), join(dir, "events.ts"))
  copyFileSync(join(here, "tsconfig.json"), join(dir, "tsconfig.json"))
  copyFileSync(join(here, "legacy.vibe.txt"), join(dir, "main.vibe"))
  const call = (...args) => spawnSync(compiler, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8", timeout: 120000 })
  const before = call("--noEmit")
  assert.ifError(before.error)
  assert.equal(before.status, 2, before.stdout + before.stderr)
  assert.match(before.stdout, /TS2769/)
  const fixed = call("--fix")
  assert.ifError(fixed.error)
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  const source = readFileSync(join(dir, "main.vibe"), "utf8")
  const actual = await import(pathToFileURL(join(dir, "out/main.js")))
  const result = Effect.runSync(actual.verify())
  assert.deepEqual(result, { value: 7, events: ["loaded:symbol", "scope", "program"] })
  const again = call("--fix")
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), source)

  mkdirSync(join(dir, "reference"))
  copyFileSync(join(here, "reference.ts.txt"), join(dir, "reference/main.ts"))
  copyFileSync(join(here, "events.ts"), join(dir, "reference/events.ts"))
  writeFileSync(join(dir, "reference/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" }, include: ["*.ts"] }))
  const expected = spawnSync(process.execPath, [stock, "-p", join(dir, "reference/tsconfig.json")], { encoding: "utf8", timeout: 60000 })
  assert.equal(expected.status, 0, expected.stdout + expected.stderr)
  const reference = await import(pathToFileURL(join(dir, "reference/out/main.js")))
  assert.deepEqual(Effect.runSync(reference.verify()), result)
  writeFileSync(join(dir, "api.ts"), 'import {verify as actual} from "./out/main.js";import {verify as expected} from "./reference/out/main.js";const a:typeof actual=expected;const b:typeof expected=actual;type Exact<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;const exact:Exact<ReturnType<typeof actual>,ReturnType<typeof expected>>=true;')
  writeFileSync(join(dir, "api.config.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true }, files: ["api.ts"] }))
  const api = spawnSync(process.execPath, [stock, "-p", join(dir, "api.config.json")], { encoding: "utf8", timeout: 60000 })
  assert.equal(api.status, 0, api.stdout + api.stderr)
  console.log("legacy forkIn preserves evaluation and types")
} finally { rmSync(dir, { recursive: true, force: true }) }
