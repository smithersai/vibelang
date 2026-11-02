import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { restoreScripts, rewriteScripts } from "../lib/codemod.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")

function project(manifests) {
  const root = mkdtempSync(join(tmpdir(), "migrate-scripts-"))
  for (const [manifest, scripts] of Object.entries(manifests)) {
    mkdirSync(join(root, dirname(manifest)), { recursive: true })
    writeFileSync(join(root, manifest), JSON.stringify({ name: manifest, scripts }, null, 2) + "\n")
  }
  return root
}
const scriptsOf = (root, manifest) => JSON.parse(readFileSync(join(root, manifest), "utf8")).scripts

// t3code: 27 entry points whose package scripts named the renamed .ts file
// (drive-t3code 19:05Z, drive-t3code-server 19:07Z), so `pnpm generate` failed
// with ERR_MODULE_NOT_FOUND after the rename.
test("t3code: package scripts name a renamed entry point's .vibe file, and revert names the .ts again", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-package-script-entrypoints.json", import.meta.url), "utf8"))
  const root = project(corpus.manifests)
  try {
    const renames = corpus.renames.map((from) => ({ from, to: from.replace(/\.ts$/, ".vibe") }))
    const edits = rewriteScripts(root, renames)
    for (const [manifest, scripts] of Object.entries(corpus.after)) assert.deepEqual(scriptsOf(root, manifest), scripts, `${corpus.key}: ${manifest}`)
    for (const { from } of renames) restoreScripts(root, edits, from)
    for (const [manifest, scripts] of Object.entries(corpus.manifests)) assert.deepEqual(scriptsOf(root, manifest), scripts, `${corpus.key}: ${manifest} restored`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("only a word that is the module's path changes: not a longer name, another directory or a .tsx", () => {
  const scripts = {
    a: "node --import vibelang/register scripts/run.ts --flag",
    b: "node scripts/run.tsx",
    c: "node xscripts/run.ts",
    d: "node other/scripts/run.ts",
    e: 'node "./scripts/run.ts" && echo scripts/run.ts',
    f: "node --entry=scripts/run.ts",
  }
  const root = project({ "package.json": scripts })
  try {
    const edits = rewriteScripts(root, [{ from: "scripts/run.ts", to: "scripts/run.vibe" }])
    assert.deepEqual(scriptsOf(root, "package.json"), {
      a: "node --import vibelang/register scripts/run.vibe --flag",
      b: "node scripts/run.tsx",
      c: "node xscripts/run.ts",
      d: "node other/scripts/run.ts",
      e: 'node "./scripts/run.vibe" && echo scripts/run.vibe',
      f: "node --entry=scripts/run.vibe",
    })
    assert.deepEqual(edits.map((e) => e.script), ["a", "e", "f"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const word = fc.constantFrom("scripts/run.ts", "./scripts/run.ts", "scripts/run.tsx", "scripts/other.ts", "xscripts/run.ts", "--flag", "dev", "&&", "echo")
const command = fc.tuple(fc.constantFrom("node", "node --import vibelang/register", "bun", "tsx"), fc.array(word, { maxLength: 5 }), fc.constantFrom("", '"', "'"))
  .map(([runner, words, q]) => [runner, ...words.map((w) => (w.includes("/") && q ? q + w + q : w))].join(" "))

test("property: rewriteScripts then restoreScripts gives the scripts back, and rewrites exactly the module's path words", () => {
  fc.assert(fc.property(fc.dictionary(fc.constantFrom("dev", "build", "gen", "smoke"), command, { minKeys: 1 }), (scripts) => {
    const root = project({ "package.json": scripts })
    try {
      const edits = rewriteScripts(root, [{ from: "scripts/run.ts", to: "scripts/run.vibe" }])
      const after = scriptsOf(root, "package.json")
      for (const [name, text] of Object.entries(scripts)) {
        const words = text.split(/[\s"']+/)
        const expected = words.filter((w) => w === "scripts/run.ts" || w === "./scripts/run.ts").length
        assert.equal(after[name].split(/[\s"']+/).filter((w) => w === "scripts/run.vibe" || w === "./scripts/run.vibe").length, expected, name)
        assert.equal(after[name].replaceAll("scripts/run.vibe", "scripts/run.ts"), text, name)
      }
      restoreScripts(root, edits, "scripts/run.ts")
      assert.deepEqual(scriptsOf(root, "package.json"), { ...scripts })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 1905, numRuns: 150 })
})

// Ported onto migflow-foldkit's durable codemod state: the script edit is
// prepared with the batch, recorded as packageScriptEdits (Vite's own
// scriptEdits keep their name), and written only when the state is applied.
test("prepareState records a package script that runs a renamed entry point, and applyState writes it", async () => {
  const { applyState, prepareState } = await import("../lib/codemod-state.mjs")
  const root = mkdtempSync(join(tmpdir(), "migrate-scripts-state-"))
  try {
    mkdirSync(join(root, "src"), { recursive: true })
    const manifest = JSON.stringify({ name: "server", scripts: { start: "bun src/index.ts", test: "vitest" } }, null, 2) + "\n"
    writeFileSync(join(root, "package.json"), manifest)
    writeFileSync(join(root, "src/index.ts"), "export const port = 1\n")
    const state = prepareState(root, ["src/index.ts"], ["src/index.ts"])
    assert.deepEqual(state.packageScriptEdits, [{ manifest: "package.json", script: "start", module: "src/index.vibe" }])
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), manifest, "nothing is written before applyState")
    applyState(root, state)
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts, { start: "bun src/index.vibe", test: "vitest" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

for (const mode of ["batch", "one-pass"]) test("t3code " + mode + ": package-script receipts survive rename and per-file revert", async t => {
  const { codemod, makeConfig, paths, revert } = await import("../lib/steps.mjs")
  const { onePassStep } = await import("../lib/onepass.mjs")
  const Jj = await import("../lib/jj.mjs")
  const { must, writeJson } = await import("../lib/util.mjs")
  const root = mkdtempSync(join(tmpdir(), "migrate-script-flow-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(repo, "src"), { recursive: true })
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true })
  const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(repo, "node_modules/typescript"))
  const start = "node --import vibelang/register src/index.ts"
  writeJson(join(repo, "package.json"), { name: "app", private: true, scripts: { start } })
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n")
  writeJson(join(repo, "tsconfig.json"), { compilerOptions: { noEmit: true }, include: ["src"] })
  writeFileSync(join(repo, "src/index.ts"), "export const marker = 73\n")
  writeProbeAwareCompiler(join(repo, "node_modules/.bin/vibelang"), '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', { mode: 0o755 })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: repo })
  await Jj.commit(repo, "base")
  writeJson(paths(run).config, makeConfig({ target: repo, test: "true", vibelangVersion: "0.0.0" }))
  writeJson(paths(run).plan, { ...(mode === "one-pass" ? { mode } : {}), batches: [{ files: ["src/index.ts"] }] })
  const result = mode === "one-pass" ? await onePassStep("rename", { run }) : await codemod({ run, batch: "01" })
  assert.equal(scriptsOf(repo, "package.json").start, start.replace(".ts", ".vibe"))
  assert.deepEqual(result.packageScriptEdits, [{ manifest: "package.json", script: "start", module: "src/index.vibe" }])
  await revert({ run, batch: "01", file: "src/index.vibe", reason: "script regression rollback" })
  assert.equal(scriptsOf(repo, "package.json").start, start)
})
