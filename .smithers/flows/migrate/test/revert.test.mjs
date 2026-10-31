import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteExports, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, returnToUpgrade, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

// A real jj repository and run directory: the batch is renamed and its
// consumers rewritten as codemod does, then one file goes back to .ts.
// A real jj repository: an earlier setup's .gitignore goes with its commit, and
// jj snapshots what that file kept out into the next setup's commit.
test("returning to the upgrade leaves an earlier setup's toolchain out of the next commit", async () => {
  const target = mkdtempSync(join(tmpdir(), "migrate-setup-again-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    writeFileSync(join(target, "package.json"), "{}\n")
    const upgrade = await Jj.commit(target, "upgrade effect")
    writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\n")
    mkdirSync(join(target, ".vibelang-toolchain"))
    writeFileSync(join(target, ".vibelang-toolchain/vibelang-runtime-0.0.11.tgz"), "tarball\n")
    await Jj.commit(target, "set up the old toolchain")

    await returnToUpgrade(target, upgrade)
    assert.equal(await Jj.commitId(target, "@-"), upgrade)
    assert.deepEqual(await Jj.changedPaths(target), [])
    assert.equal(existsSync(join(target, ".vibelang-toolchain")), false)
  } finally {
    rmSync(target, { recursive: true, force: true })
  }
})

test("revert takes back the exports entry the codemod added for the file", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-revert-exports-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  try {
    mkdirSync(join(target, "src"), { recursive: true })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    writeFileSync(join(target, "package.json"), JSON.stringify({ exports: { "./*": "./src/*.ts" } }))
    writeFileSync(join(target, "src/b.ts"), "export const b = 1\n")
    writeFileSync(join(target, "src/c.ts"), "export const c = 1\n")
    await Jj.commit(target, "base")
    writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
    writeJson(paths(run).plan, { batches: [{ files: ["src/b.ts", "src/c.ts"] }] })
    const exportEdits = rewriteExports(target, renameBatch(target, ["src/b.ts", "src/c.ts"]))
    writeJson(paths(run).codemod("01"), { exportEdits, importEdits: [] })
    const reverted = await revert({ run, batch: "01", file: "src/b.vibe", reason: "blocked on an issue" })
    assert.deepEqual(readJson(join(target, "package.json")).exports, { "./c": "./src/c.vibe", "./*": "./src/*.ts" })
    assert.deepEqual(reverted.exportEdits.map((e) => e.key), ["./b"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("revert returns a file to .ts and points every import the codemod rewrote back at it", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-revert-"))
  const target = join(root, "repo")
  const run = join(root, "run")
  try {
    mkdirSync(join(target, "src"), { recursive: true })
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    writeFileSync(join(target, "package.json"), "{}\n")
    writeFileSync(join(target, "src/a.ts"), 'import { b } from "./b.ts"\nexport const a = b\n')
    writeFileSync(join(target, "src/b.ts"), "export const b = 1\n")
    writeFileSync(join(target, "src/b.test.ts"), 'import { b } from "./b.ts"\n')
    writeFileSync(join(target, "src/c.ts"), 'import { b } from "./b.js"\nexport const c = b\n')
    writeFileSync(join(target, "src/d.ts"), 'import { b } from "./b.js"\nexport const d = b\n')
    await Jj.commit(target, "base")

    writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
    writeJson(paths(run).plan, { batches: [{ files: ["src/b.ts", "src/c.ts"] }] })
    renameBatch(target, ["src/b.ts", "src/c.ts"])
    const scope = ["src/a.ts", "src/b.test.ts", "src/b.vibe", "src/c.vibe", "src/d.ts"]
    const importEdits = rewriteImports(target, scope)
    assert.deepEqual(importEdits.map((e) => `${e.file}: ${e.to}`), ["src/a.ts: ./b.vibe", "src/b.test.ts: ./b.vibe", "src/c.vibe: ./b.vibe", "src/d.ts: ./b.vibe"])
    writeJson(paths(run).codemod("01"), { importEdits })
    writeFileSync(join(target, "src/b.d.vibe.ts"), "export declare const b = 1;\n")

    const reverted = await revert({ run, batch: "01", file: "src/b.vibe", reason: "blocked on an issue" })
    assert.equal(readFileSync(join(target, "src/b.ts"), "utf8"), "export const b = 1\n")
    assert.equal(existsSync(join(target, "src/b.vibe")), false)
    assert.equal(readFileSync(join(target, "src/a.ts"), "utf8"), 'import { b } from "./b.ts"\nexport const a = b\n')
    assert.equal(readFileSync(join(target, "src/b.test.ts"), "utf8"), 'import { b } from "./b.ts"\n')
    // A .vibe importer names the module by its source name, now .ts.
    assert.equal(readFileSync(join(target, "src/c.vibe"), "utf8"), 'import { b } from "./b.ts"\nexport const c = b\n')
    // A TypeScript importer gets back the specifier it had: ./b.js stays ./b.js.
    assert.equal(readFileSync(join(target, "src/d.ts"), "utf8"), 'import { b } from "./b.js"\nexport const d = b\n')
    assert.equal(existsSync(join(target, "src/b.d.vibe.ts")), false)
    assert.deepEqual(reverted.importEdits, [
      { file: "src/a.ts", from: "./b.vibe", to: "./b.ts" },
      { file: "src/b.test.ts", from: "./b.vibe", to: "./b.ts" },
      { file: "src/d.ts", from: "./b.vibe", to: "./b.js" },
      { file: "src/c.vibe", from: "./b.vibe", to: "./b.ts" }
    ])
    assert.deepEqual(readJson(paths(run).reverted("01")).map((r) => [r.file, r.reason]), [["src/b.ts", "blocked on an issue"]])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
