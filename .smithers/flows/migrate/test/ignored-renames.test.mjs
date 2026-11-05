import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { writeProbeAwareCompiler } from "./fake-vibelang.mjs"
import { codemod, makeConfig, paths, revert } from "../lib/steps.mjs"
import { onePassStep } from "../lib/onepass.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-ignored-native-rename.json", import.meta.url), "utf8"))

async function fixture(file) {
  const root = mkdtempSync(join(tmpdir(), "migrate-ignored-source-")), repo = join(root, "repo"), run = join(root, "run")
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  mkdirSync(join(repo, "node_modules/.bin"), { recursive: true })
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(repo, "node_modules/typescript"))
  writeJson(join(repo, "package.json"), { name: "app", private: true })
  writeJson(join(repo, "tsconfig.json"), { compilerOptions: { noEmit: true }, include: ["src"] })
  writeFileSync(join(repo, ".gitignore"), "node_modules/\nlib/\n")
  writeFileSync(join(repo, file), "export const value = 1\n")
  writeFileSync(join(repo, dirname(file), "unrelated.vibe"), "export const unrelated = 2\n")
  writeProbeAwareCompiler(join(repo, "node_modules/.bin/vibelang"), '#!/bin/sh\necho "vibelang --fix: 0 fixes in 0 files."\n', { mode: 0o755 })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: repo })
  execFileSync("jj", ["file", "track", "--include-ignored", "--", "root-file:" + JSON.stringify(file)], { cwd: repo })
  await Jj.commit(repo, "fixture")
  writeJson(paths(run).config, makeConfig({ target: repo, test: "true", vibelangVersion: "0.0.0" }))
  return { root, repo, run }
}

for (const mode of ["batch", "one-pass"]) test(mode + " migration retains an ignored authored source in repository snapshots", async () => {
  const f = await fixture(corpus.source)
  try {
    writeJson(paths(f.run).plan, { ...(mode === "one-pass" ? { mode } : {}), batches: [{ files: [corpus.source] }] })
    const rename = () => mode === "one-pass" ? onePassStep("rename", { run: f.run }) : codemod({ run: f.run, batch: "01" })
    await rename()
    assert.ok(existsSync(join(f.repo, corpus.native)), "the conversion exists on disk")
    assert.ok((await Jj.trackedFiles(f.repo)).includes(corpus.native), "a snapshot must retain the authored conversion")
    assert.ok(!(await Jj.trackedFiles(f.repo)).includes("src/internal/lib/unrelated.vibe"), "ignored siblings stay excluded")
    await rename()
    const converted = await Jj.commit(f.repo, "converted")
    assert.equal((await Jj.bytesAt(f.repo, converted, corpus.native)).toString("utf8"), "export const value = 1\n")
    await revert({ run: f.run, batch: "01", file: corpus.native, reason: "regression control" })
    assert.ok((await Jj.trackedFiles(f.repo)).includes(corpus.source), "returning an ignored original also retains it")
    assert.ok(!(await Jj.trackedFiles(f.repo)).includes(corpus.native))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test("property: ignored source names remain literal paths and never admit ignored siblings", async () => {
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("validators", "literal[1]", "with space", "comma,name", "quote'name", "hash#name"),
    fc.constantFrom("src/lib", "src/internal/lib", "src/deeper/lib"),
    async (name, dir) => {
      const source = dir + "/" + name + ".ts", native = source.replace(/\.ts$/, ".vibe"), f = await fixture(source)
      try {
        writeJson(paths(f.run).plan, { mode: "one-pass", batches: [{ files: [source] }] })
        await onePassStep("rename", { run: f.run })
        const files = await Jj.trackedFiles(f.repo)
        assert.ok(files.includes(native), native)
        assert.ok(!files.includes(dir + "/unrelated.vibe"))
        const revision = await Jj.commit(f.repo, "converted")
        assert.equal((await Jj.bytesAt(f.repo, revision, native)).toString("utf8"), "export const value = 1\n")
      } finally { rmSync(f.root, { recursive: true, force: true }) }
    }
  ), { seed: 514278, numRuns: 40 })
})
