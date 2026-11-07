// run-seconds: 300
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const modules = fileURLToPath(new URL("./node_modules", import.meta.url))
const roots = []
// project writes files into a new temporary project that resolves the case's
// packages and emits to out/, and returns its directory.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-callback-"))
  roots.push(root)
  fs.symlinkSync(modules, path.join(root, "node_modules"), "dir")
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n')
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], lib: ["ES2022"], outDir: "out" },
    include: ["*.vibe", "*.ts"],
  }))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text)
  return root
}
function vibelang(root, ...args) {
  const r = spawnSync(binary, ["-p", "tsconfig.json", ...args, "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
// exits runs every program for both reasons and describes each Exit,
// comparing a defect with the very object the helper threw.
function exits(root) {
  fs.writeFileSync(path.join(root, "runner.mjs"), `import { Cause, Effect, Exit } from "effect"
import { marker } from "./out/foreign.js"
import * as m from "./out/main.js"
const out = []
for (const name of ["respond", "respondAll", "respondMatch"]) for (const reason of ["ok", "throw"]) {
  const exit = await Effect.runPromiseExit(m[name](reason))
  out.push(Exit.isSuccess(exit) ? [name, reason, "success", exit.value] : [name, reason, exit.cause.reasons.map((r) => r._tag), Cause.squash(exit.cause) === marker])
}
console.log(JSON.stringify(out))
`)
  const r = spawnSync(process.execPath, ["runner.mjs"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return JSON.parse(r.stdout)
}
const foreign = `export const marker = { defect: true }
export const reject = (reason: string) => {
  if (reason === "throw") throw marker
  return { status: 403, reason }
}
`
const source = `import * as Effect from "effect/Effect"
import * as Data from "effect/Data"
import { reject } from "./foreign.js"
class PushDenied extends Data.TaggedError("PushDenied")<{ readonly reason: string }> {}
export const respond = (reason: string) =>
  Effect.fail(new PushDenied({ reason })).pipe(
    Effect.catchTag("PushDenied", (error) => Effect.succeed(reject(error.reason))),
  )
export const respondAll = (reason: string) =>
  Effect.catchTags(Effect.fail(new PushDenied({ reason })), { PushDenied: (error) => Effect.succeed(reject(error.reason)) })
export const respondMatch = (reason: string) =>
  Effect.matchEffect(Effect.succeed(reason), { onFailure: () => Effect.void, onSuccess: (r) => Effect.succeed(reject(r)) })
`
try {
  const stock = project({ "main.ts": source, "foreign.ts": foreign })
  const built = vibelang(stock)
  assert.equal(built.status, 0, built.output)
  const want = exits(stock)
  assert.ok(want.some((row) => row[3] === true), JSON.stringify(want))
  const converted = project({ "main.vibe": source, "foreign.ts": foreign })
  vibelang(converted, "--fix")
  const text = fs.readFileSync(path.join(converted, "main.vibe"), "utf8")
  assert.equal(text.match(/catch \(thrown\) \{ return die\(thrown\) \}/g)?.length, 3, text)
  const compiled = vibelang(converted)
  assert.equal(compiled.status, 0, compiled.output + "\n" + text)
  assert.deepEqual(exits(converted), want, text)
  console.log("--fix wraps fiber-run handler callbacks and keeps the TypeScript program's Exit")
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
}
