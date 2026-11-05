import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { listSources, resolveSource } from "vibelang/source"
import { projectBackend } from "vibelang/project"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [compiler, effect, join(runtime, "dist/index.d.ts")].find(file => !existsSync(file))
const skip = missing && "build the compiler and runtime and install Effect before native snippet tests"

test("mixed snippets keep native diagnostics, error polarity and dependency invalidation", { skip }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-snippet-check-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(effect, join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const project = join(root, "tsconfig.json")
  writeFileSync(project, JSON.stringify({ compilerOptions: {
    strict: true, target: "ES2022", module: "NodeNext", types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, noEmit: true
  }, include: ["*.ts", "*.vibe"] }))
  writeFileSync(join(root, "dependency.ts"), 'export const value: number = 42\n')
  writeFileSync(join(root, "ordinary.vibe"), 'export effect function answer(): number!! { return 42 }\n')
  writeFileSync(join(root, "negative.error.vibe"), 'export const value: number = "wrong"\n')
  writeFileSync(join(root, "native.error.vibe"), 'export const broken = effect { return try 123 }\n')
  const sources = listSources(root)
  assert.equal(sources.length, 4)
  assert.equal(resolveSource(join(root, "ordinary.ts")), join(root, "ordinary.vibe"))
  const trace = []
  const backend = projectBackend({ root, compiler, cache: { directory: join(root, ".cache") }, debug: message => trace.push(message) })
  t.after(() => backend.close())
  const check = async () => {
    const result = await backend.compile(project)
    for (const file of listSources(root)) assert.ok(result.files.includes(file), "compiler checked " + relative(root, file))
    assert.deepEqual(result.errors.filter(d => !d.file), [], "configuration and process errors cannot stand in for snippet failures")
    return result
  }
  const first = await check()
  assert.deepEqual(first.errors.filter(d => d.file === join(root, "ordinary.vibe")), [])
  const negative = first.errors.filter(d => d.file === join(root, "negative.error.vibe"))
  assert.equal(negative.length, 1)
  assert.equal(negative[0].code, "TS2322")
  assert.equal(negative[0].line, 1)
  assert.ok(negative[0].column > 0)
  assert.ok(first.errors.some(d => d.file === join(root, "native.error.vibe") && d.code.startsWith("EK")))
  writeFileSync(join(root, "negative.error.vibe"), 'export const value: number = 42\n')
  writeFileSync(join(root, "native.error.vibe"), 'export const value = 42\n')
  // The cache deliberately declines inputs edited within its timestamp grace period.
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.deepEqual((await check()).errors, [], "an expected-error source that starts passing is visible to the builder")
  const cached = await check()
  assert.deepEqual(cached.errors, [])
  assert.ok(trace.some(message => message.includes("from the cache")), trace.join("\n"))
  writeFileSync(join(root, "dependency.ts"), 'export const value: number = "changed"\n')
  assert.ok((await check()).errors.some(d => d.file === join(root, "dependency.ts") && d.code === "TS2322"))
  renameSync(join(root, "ordinary.vibe"), join(root, "renamed.vibe"))
  assert.equal(resolveSource(join(root, "ordinary.ts")), undefined)
  assert.equal(resolveSource(join(root, "renamed.ts")), join(root, "renamed.vibe"))
  assert.ok(listSources(root).includes(join(root, "renamed.vibe")))
})
