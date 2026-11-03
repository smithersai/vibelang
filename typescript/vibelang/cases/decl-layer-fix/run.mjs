// run-seconds: 390
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_TEST_COMPILER ?? path.resolve(here, "../../../built/local/tsc")
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "layer-migration-"))
const config = { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, declaration: true, outDir: "out", rootDir: ".", noEmitOnError: false }, files: ["main.vibe"] }
const run = (command, args, cwd, timeout, expectedStatus = 0) => {
  const child = spawnSync(command, args, { cwd, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 })
  assert.equal(child.status, expectedStatus, `${path.basename(command)} failed: ${child.error ?? ""}\n${child.stdout}\n${child.stderr}`)
  return child.stdout
}
const project = (name, source) => {
  const dir = path.join(scratch, name)
  fs.mkdirSync(dir)
  fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "layer-migration-check", type: "module" }))
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
  fs.writeFileSync(path.join(dir, "main.vibe"), source)
  return dir
}
const compile = (dir, fix = false, retired = false) => {
 const output = run(compiler, ["-p", ".", "--pretty", "false", ...(fix ? ["--fix"] : [])], dir, 30_000, retired ? 2 : 0)
 if (retired) assert.match(output, /error EK2121:.*vibelang --fix/)
 return output
}
const exit = (dir) => JSON.parse(run(process.execPath, ["--input-type=module", "-e", 'import { Effect } from "effect"; import { main } from "./out/main.js"; console.log(JSON.stringify(Effect.runSyncExit(main())))'], dir, 10_000).trim())

try {
  for (const [namespace, prefix] of [["implicit", ""], ["root-import", 'import { Layer } from "effect";\n'], ["namespace-import", 'import * as Layer from "effect/Layer";\n']]) {
  for (const kind of ["eager", "setup", "setup-failure"]) {
    const setup = kind === "eager" ? "" : `events.push("setup"); const start = ${kind === "setup-failure" ? 'try Effect.fail("setup")' : "7"};\n`
    const value = kind === "eager" ? "7" : "start"
    const source = prefix + `service Counter { static readonly key = "test/LayerMigration"; value: number }
const events: string[] = []
export layer Live: Counter {
 ${setup}readonly value = (events.push("member"), ${value})
}
export effect function main() {
 let value = 0
 provide Live { value = (try Counter).value; }
 return { value, events: events.join(",") }
}
`
    const dir = project(namespace + "-" + kind, source)
    compile(dir, false, true)
    const beforeDts = fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8")
    const before = exit(dir)
    assert.equal(before._tag, kind === "setup-failure" ? "Failure" : "Success")
    if (before._tag === "Success") assert.deepEqual(before.value, { value: 7, events: kind === "eager" ? "member" : "setup,member" })
    compile(dir, true)
    const fixed = fs.readFileSync(path.join(dir, "main.vibe"), "utf8")
    assert.ok(!fixed.includes("layer Live:"), "the CLI left a safe legacy declaration unchanged")
    assert.ok(fixed.includes(kind === "eager" ? "Layer.succeed(Counter," : "Layer.effect(Counter, effect {"), fixed)
    compile(dir)
    assert.equal(fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8"), beforeDts, "the public declaration bytes changed")
    assert.deepEqual(exit(dir), before, "the migration changed Exit or initialization timing")
  }
  }
  for (const [name, prefix] of [
    ["shadowed", 'import * as ActualLayer from "effect/Layer";\nconst reads: string[] = [];\nconst Layer: typeof ActualLayer = { ...ActualLayer, get succeed() { reads.push("captured"); return ActualLayer.succeed }, get effect() { reads.push("captured"); return ActualLayer.effect } };\n'],
    ["type-only", 'import type { Layer } from "effect";\n'],
  ]) {
    const source = prefix + 'service Counter { static readonly key = "test/LayerMigration"; value: number }\nlayer Live: Counter { readonly value = 7 }\nexport { Live }\n'
    const dir = project(name, source)
    compile(dir, true, true)
    assert.equal(fs.readFileSync(path.join(dir, "main.vibe"), "utf8"), source, "an unavailable constructor must not be captured")
  }
  console.log("layer migration preserves 9 APIs and Exits; 2 namespace refusals")
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
