import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"

// A real jj repository: the flow's version control is jj's command line.
test("commits land on the bookmark, one on top of the last", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-jj-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    assert.equal(await Jj.commit(root, "nothing"), null)
    writeFileSync(join(root, "a.ts"), "export const a = 1\n")
    const base = await Jj.commit(root, "base")
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), null)
    await Jj.setBookmark(root, "vibe", base)
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), base)
    writeFileSync(join(root, "a.ts"), "export const a = 2\n")
    assert.deepEqual(await Jj.changedPaths(root), [{ status: "M", path: "a.ts" }])
    const next = await Jj.commit(root, "batch 01")
    await Jj.setBookmark(root, "vibe", next)
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), next)
    assert.equal(await Jj.commitId(root, "vibe-"), base)
    assert.equal(await Jj.fileAt(root, base, "a.ts"), "export const a = 1\n")
    await assert.rejects(Jj.setBookmark(root, "vibe", base), /backwards|sideways/)
    await Jj.setBookmark(root, "vibe", base, { restart: true })
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), base)
    await Jj.newAt(root, base)
    assert.equal(await Jj.commitId(root, "@-"), base)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
