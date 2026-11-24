// #535: a bulk revert that fails midway is rerunnable. The second requested
// module fails the "did every module return" check (jj exits 0 without
// restoring it); a rerun finishes the first module's importer and export
// restoration instead of refusing it as "already reverted".
import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { renameBatch, rewriteExports, rewriteImports } from "../lib/codemod.mjs"
import { makeConfig, paths, revertMany } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const put = (root, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

test("a bulk revert whose second module did not return completes the first on rerun", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-revert-rerun-"))
  const target = join(root, "target"), run = join(root, "run"), bin = join(root, "bin")
  const PATH = process.env.PATH
  try {
    const originals = {
      "package.json": JSON.stringify({ name: "rerun", version: "1.0.0", type: "module", exports: { "./a": "./src/a.ts", "./b": "./src/b.ts" } }, null, 2) + "\n",
      "src/a.ts": "export const a = 1\n",
      "src/b.ts": "export const b = 2\n",
      "src/use.ts": 'import { a } from "./a.ts"\nimport { b } from "./b.ts"\nexport const sum = a + b\n'
    }
    put(target, originals)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    await Jj.commit(target, "original")
    writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
    const files = ["src/a.ts", "src/b.ts"]
    writeJson(paths(run).plan, { batches: [{ files }] })
    const renames = renameBatch(target, files)
    const exportEdits = rewriteExports(target, renames)
    const importEdits = rewriteImports(target, renames.map(r => r.to).concat("src/use.ts"))
    assert.ok(exportEdits.some(e => e.module === "src/a.vibe"), JSON.stringify(exportEdits))
    assert.match(readFileSync(join(target, "src/use.ts"), "utf8"), /"\.\/a\.vibe"/)
    writeJson(paths(run).codemod("01"), { files, renames, exportEdits, importEdits })

    // jj restore that silently skips src/b: the command succeeds, b stays .vibe.
    const jj = execFileSync("sh", ["-c", "command -v jj"], { encoding: "utf8" }).trim()
    mkdirSync(bin)
    writeFileSync(join(bin, "jj"), `#!/bin/sh
if [ "$1" = restore ]; then
  first=1
  for arg in "$@"; do
    if [ $first = 1 ]; then set --; first=0; fi
    case "$arg" in *src/b.*) ;; *) set -- "$@" "$arg" ;; esac
  done
fi
exec ${JSON.stringify(jj)} "$@"
`, { mode: 0o755 })
    process.env.PATH = bin + ":" + PATH
    const request = files.map(file => ({ file: file.replace(/\.ts$/, ".vibe"), reason: "rerun witness" }))
    await assert.rejects(revertMany({ run, batch: "01", files: request }), /^Error: revert did not restore src\/b\.vibe$/)
    process.env.PATH = PATH
    assert.equal(readFileSync(join(target, "src/a.ts"), "utf8"), originals["src/a.ts"])
    assert.equal(existsSync(join(target, "src/a.vibe")), false)
    assert.equal(existsSync(join(target, "src/b.vibe")), true)
    assert.equal(existsSync(paths(run).reverted("01")), false)

    const results = await revertMany({ run, batch: "01", files: request })
    assert.deepEqual(results.map(r => r.file), files)
    for (const [file, text] of Object.entries(originals)) {
      if (file === "package.json") assert.deepEqual(readJson(join(target, file)), JSON.parse(text))
      else assert.equal(readFileSync(join(target, file), "utf8"), text, file)
    }
    assert.ok(results[0].exportEdits.length > 0 && results[0].importEdits.length > 0, JSON.stringify(results[0]))
    assert.deepEqual(readJson(paths(run).reverted("01")).map(r => r.file), files)
    assert.equal(existsSync(join(paths(run).batch("01"), "revert-journal.json")), false)
    // A finished revert is not journaled: asking again still refuses.
    await assert.rejects(revertMany({ run, batch: "01", files: request.slice(0, 1) }), /^Error: missing \.vibe module \(already reverted\?\): src\/a\.vibe$/)
  } finally {
    process.env.PATH = PATH
    rmSync(root, { recursive: true, force: true })
  }
})
