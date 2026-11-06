import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { renameBatch } from "../lib/codemod.mjs"
import * as Jj from "../lib/jj.mjs"
import { refreshProjectReferences } from "../lib/reference-outputs.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import { writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-revert-reference-diagnostics.json", import.meta.url)))
const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const skip = !existsSync(binary) && "build the native compiler"

function linkedProjects(target) {
  const put = (file, text) => {
    mkdirSync(dirname(join(target, file)), { recursive: true })
    writeFileSync(join(target, file), typeof text === "string" ? text : JSON.stringify(text))
  }
  put("package.json", { type: "module", private: true })
  put(".gitignore", "node_modules/\n**/lib/\n**/types/\n**/cache/\n**/*.d.vibe.ts\n")
  put("tsconfig.json", { files: [], references: [{ path: "consumer" }] })
  put("base.json", { compilerOptions: { composite: true, declaration: true, target: "ESNext", module: "ESNext", types: [] },
    vibe: { effectGlobals: false, effectModules: false } })
  for (const [name, references] of [["producer", []], ["consumer", [{ path: "../producer" }]]])
    put(name + "/tsconfig.json", { extends: "../base.json", compilerOptions: {
      rootDir: "src", outDir: "lib", declarationDir: "types", tsBuildInfoFile: "cache/build.tsbuildinfo" },
      include: ["src"], references })
  return put
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "revert-reference-diagnostics-"))
  const put = linkedProjects(root)
  put("producer/src/main.ts", corpus.producer)
  put("consumer/src/main.ts", "export const value = 1\n")
  return { root, configs: ["tsconfig.json", "producer/tsconfig.json", "consumer/tsconfig.json"],
    changed: ["producer/src/main.ts"], tracked: [], compiler: "compiler", close: () => rmSync(root, { recursive: true, force: true }) }
}

test("a revert rebuild accepts a finished compile that reports diagnostics, and only that", async () => {
  await fc.assert(fc.asyncProperty(fc.oneof(
    fc.constantFrom(0, 1, 2).map(code => ({ code, signal: null })),
    fc.integer({ min: 3, max: 255 }).map(code => ({ code, signal: null })),
    fc.constant({ code: null, signal: "SIGKILL" })), fc.boolean(), async ({ code, signal }, diagnosticsAllowed) => {
    const f = fixture(), log = join(f.root, "refresh.log")
    try {
      const stdout = code === 1 || code === 2 ? "consumer/src/broken.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.\n" : ""
      const execute = async () => ({ code, signal, stdout, stderr: "" })
      const finished = !signal
      const accepted = finished && (code === 0 || (diagnosticsAllowed && (code === 1 || code === 2)))
      const refresh = refreshProjectReferences({ ...f, ts, log, execute, diagnosticsAllowed })
      if (!accepted) return await assert.rejects(refresh)
      const receipt = await refresh
      assert.equal(receipt.state, code === 0 ? "complete" : "diagnostics")
      assert.equal(JSON.parse(readFileSync(log + ".json", "utf8")).state, receipt.state)
    } finally { f.close() }
  }), { numRuns: 40, seed: 272727 })
})

test("reverting a module succeeds while another project still has errors", { skip }, async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(corpus.rule))
  const root = mkdtempSync(join(tmpdir(), "revert-reference-diagnostics-")), target = join(root, "repo"), run = join(root, "run")
  try {
    const put = linkedProjects(target)
    put("producer/src/main.ts", corpus.producer)
    put("consumer/src/broken.ts", corpus.consumerError)
    mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
    symlinkSync(binary, join(target, "node_modules/.bin/vibelang"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    const init = spawnSync("sh", ["-c", "jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost"], { cwd: target, encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    await Jj.commit(target, "original source")
    const file = "producer/src/main.ts", p = paths(run), renames = renameBatch(target, [file])
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(p.plan, { batches: [{ files: [file] }] })
    writeJson(p.codemod("01"), { renames, importEdits: [] })
    const result = await revert({ run, batch: "01", file: renames[0].to, reason: "restore original source" })
    assert.equal(readFileSync(join(target, file), "utf8"), corpus.producer)
    assert.equal(existsSync(join(target, renames[0].to)), false)
    assert.equal(result.referenceRefresh.state, "diagnostics")
    assert.ok([1, 2].includes(result.referenceRefresh.code))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
