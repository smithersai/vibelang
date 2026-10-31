import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { formatRecorded } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const quote = "Record resolves jj's compact rename summaries to destination paths before formatting."
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-record-rename.json", import.meta.url)))

test("foldkit-27: record formats a real jj rename destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-record-rename-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    writeFileSync(join(root, "main.ts"), "\nexport const a = 1\n")
    await Jj.commit(root, "original module")
    renameSync(join(root, "main.ts"), join(root, "main.vibe"))
    const changed = await Jj.changedPaths(root)
    assert.deepEqual(changed, [{ status: "R", path: "main.vibe", from: "main.ts" }])
    assert.ok(changed.every(f => existsSync(join(root, f.path))))
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    writeFileSync(join(root, "node_modules/.bin/vibelang-format"),
      '#!/bin/sh\nshift\nfor f in "$@"; do sed -i "1{/^$/d;}" "$f"; done\n', { mode: 0o755 })
    const formatted = await formatRecorded({ target: root, packages: [] }, changed.map(f => f.path), root)
    assert.deepEqual(formatted.files, ["main.vibe"])
    assert.equal(readFileSync(join(root, "main.vibe"), "utf8"), "export const a = 1\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("rename summaries preserve the shared prefix and suffix and ordinary changed paths", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote))
  assert.deepEqual(Jj.parseChangedPaths(corpus.summary).map(f => f.path), corpus.paths)
  const part = fc.constantFrom("module", "with space", "café", "under_score", "x.y", "{literal}")
  const path = fc.array(part, { minLength: 0, maxLength: 4 }).map(parts => parts.length ? parts.join("/") + "/" : "")
  fc.assert(fc.property(path, part, part, path, (prefix, from, to, suffix) => {
    const summary = `R ${prefix}{${from}.ts => ${to}.vibe}${suffix ? "/" + suffix + "file" : ""}\n`
    const destination = prefix + to + ".vibe" + (suffix ? "/" + suffix + "file" : "")
    assert.deepEqual(Jj.parseChangedPaths(summary), [{ status: "R", path: destination, from: prefix + from + ".ts" + (suffix ? "/" + suffix + "file" : "") }])
    for (const status of ["A", "M", "D"]) {
      assert.deepEqual(Jj.parseChangedPaths(status + " " + destination + "\n"), [{ status, path: destination }])
    }
  }), { seed: 270027, numRuns: 500 })
})

test("foldkit-27 literal braces stay in a rename prefix and suffix", () => {
  const { summary, path, from } = corpus.literalBraces
  assert.deepEqual(Jj.summaryEntry(summary), { status: "R", path, from })
})

test("bare renames and copies keep their source and destination", () => {
  for (const status of ["R", "C"]) {
    assert.deepEqual(Jj.summaryEntry(status + " old.ts => next.vibe"), { status, from: "old.ts", path: "next.vibe" })
    assert.deepEqual(Jj.summaryEntry(status + " src/{old.ts => next.vibe}"), { status, from: "src/old.ts", path: "src/next.vibe" })
  }
})
