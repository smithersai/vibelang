import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { sidecarChanges } from "../lib/declarations.mjs"
import { earlierDeclarationChanges, earlierDeclarationsIssue } from "../lib/steps.mjs"
import { validateIssue } from "../lib/issues.mjs"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-earlier-declarations.json", import.meta.url), "utf8"))
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }

// foldkit-11: round 4's setup emitted mount/index's declarations with a
// compiler that dropped readonly, and that became the baseline every batch
// passed against. The sidecar round 3 committed still had it.
test("setup reports a migrated module whose committed declaration the new toolchain changes", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-earlier-declarations-"))
  const target = join(root, "repo")
  const outDir = join(root, "dts")
  try {
    mkdirSync(target)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    put(target, "packages/foldkit/src/mount/index.vibe", "export {}\n")
    put(target, corpus.sidecar, corpus.before)
    put(target, "packages/foldkit/src/same.d.vibe.ts", "export declare const same: number;\n")
    put(target, "packages/foldkit/src/gone.d.vibe.ts", "export declare const gone: number;\n")
    put(target, "packages/other/src/x.d.vibe.ts", "export declare const x: string;\n")
    const revision = await Jj.commit(target, "an earlier run's batch")
    put(outDir, corpus.declaration, corpus.after)
    put(outDir, "same.d.ts", "export declare const same: number\n")
    const pkg = { dir: "packages/foldkit" }

    const earlier = await earlierDeclarationChanges({ ts, t: target, revision, pkg, outDir })
    assert.equal(earlier.files, 3)
    assert.deepEqual(earlier.changed.map((c) => [c.file, c.declaration]), [[corpus.sidecar, corpus.declaration]])
    assert.ok(earlier.changed[0].diff.some((line) => line.startsWith("-") && line.includes("readonly name")), earlier.changed[0].diff.join("\n"))
    assert.deepEqual(earlier.missing, ["packages/foldkit/src/gone.d.vibe.ts"])
    const issue = earlierDeclarationsIssue({ version: "VibeLang 0.0.11", revision, outDir, changes: earlier.changed })
    assert.deepEqual(validateIssue(issue), [])
    assert.match(issue.title, /changes the declarations of 1 module an earlier run migrated/)

    // A run that starts on a branch no earlier run migrated compares nothing.
    assert.deepEqual(await earlierDeclarationChanges({ ts, t: target, revision: null, pkg, outDir }), { files: 0, changed: [], missing: [] })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("sidecarChanges finds a module's declaration in a project's subdirectory", () => {
  const outDir = mkdtempSync(join(tmpdir(), "migrate-sidecar-projects-"))
  try {
    put(outDir, "tsconfig.lib.json/mount/index.d.ts", corpus.before)
    assert.deepEqual(sidecarChanges(ts, { [corpus.sidecar]: corpus.before }, outDir), { files: 1, changed: [], missing: [] })
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
})
