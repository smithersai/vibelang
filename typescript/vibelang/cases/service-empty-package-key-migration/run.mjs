import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

// run-seconds: 225
const compiler = process.env.VIBELANG_BINARY
assert.ok(compiler, "the harness must supply its compiler")
const fixture = fs.mkdtempSync(path.join(process.cwd(), "key-upgrade-"))
const oldKey = path.basename(fixture) + "/main#Named"
const oldReference = path.basename(fixture) + "/main#Reference"
function run(args, cwd = fixture) {
  const result = spawnSync(compiler, args, { cwd, encoding: "utf8", timeout: 45000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
try {
  fs.symlinkSync(path.join(process.cwd(), "node_modules"), path.join(fixture, "node_modules"), "dir")
  fs.writeFileSync(path.join(fixture, "package.json"), '{"name":"","type":"module"}\n')
  fs.writeFileSync(path.join(fixture, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "out", types: [] },
    files: ["main.vibe", "foreign.ts"]
  }))
  const source = `export service Named { value: number }
export function update(value: Named.Shape) { value.value = 2 }
export service Reference: number { static readonly defaultValue = () => 5 }
export effect function read() { return [(try Named).value, try Reference] }
`
  const foreign = `import { Context } from "effect"
export class Native extends Context.Service<Native, { readonly value: number }>()(${JSON.stringify(oldKey)}) {}
`
  fs.writeFileSync(path.join(fixture, "main.vibe"), source)
  fs.writeFileSync(path.join(fixture, "foreign.ts"), foreign)
  const missingFix = spawnSync(compiler, ["--fix-legacy-service-keys", "-p", "tsconfig.json"], { cwd: fixture, encoding: "utf8", timeout: 45000 })
  assert.equal(missingFix.error, undefined)
  assert.notEqual(missingFix.status, 0)
  assert.match(missingFix.stdout + missingFix.stderr, /TS5023/)
  assert.equal(fs.readFileSync(path.join(fixture, "main.vibe"), "utf8"), source)
  assert.equal(fs.existsSync(path.join(fixture, "out")), false)
  run(["--fix", "--fix-legacy-service-keys", "-p", "tsconfig.json"])
  const fixed = fs.readFileSync(path.join(fixture, "main.vibe"), "utf8")
  assert.ok(fixed.includes("static readonly key = " + JSON.stringify(oldKey)), fixed)
  assert.ok(fixed.includes("static readonly key = " + JSON.stringify(oldReference)), fixed)
  assert.equal(fs.readFileSync(path.join(fixture, "foreign.ts"), "utf8"), foreign)
  run(["--fix-legacy-service-keys", "--fix", "-p", "tsconfig.json"])
  assert.equal(fs.readFileSync(path.join(fixture, "main.vibe"), "utf8"), fixed, "migration must be idempotent")
  run(["-p", "tsconfig.json"])
  const declarations = fs.readFileSync(path.join(fixture, "out/main.d.ts"), "utf8")
  assert.ok(declarations.includes(JSON.stringify(oldKey)), declarations)
  fs.writeFileSync(path.join(fixture, "check.mjs"), `import assert from "node:assert/strict"
import { Effect } from "effect"
import { Named, Reference, read, update } from "./out/main.js"
import { Native } from "./out/foreign.js"
assert.equal(Named.key, ${JSON.stringify(oldKey)})
assert.equal(Reference.key, ${JSON.stringify(oldReference)})
const value = { value: 7 }
assert.deepEqual(Effect.runSync(Effect.provideService(read(), Native, value)), [7, 5])
update(value)
assert.deepEqual(Effect.runSync(Effect.provideService(read(), Native, value)), [2, 5])
`)
  const result = spawnSync(process.execPath, ["check.mjs"], { cwd: fixture, encoding: "utf8", timeout: 45000 })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  // The modern fixer must retain a newly authored current identity.
  fs.writeFileSync(path.join(fixture, "main.vibe"), source)
  run(["--fix", "-p", "tsconfig.json"])
  assert.equal(fs.readFileSync(path.join(fixture, "main.vibe"), "utf8"), source)
  console.log("service key migration ok")
} finally {
  fs.rmSync(fixture, { recursive: true, force: true })
}
