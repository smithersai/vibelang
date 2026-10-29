import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

// A real jj repository and run directory: the batch is renamed and its
// consumers rewritten as codemod does, then one file goes back to .ts.
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
