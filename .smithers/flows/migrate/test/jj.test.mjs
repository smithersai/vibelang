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

test("replaceBookmark moves a bookmark to a new setup, and refuses to orphan work built on the old one", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-jj-bookmark-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    writeFileSync(join(root, "f"), "upgrade\n")
    const upgrade = await Jj.commit(root, "upgrade effect")
    writeFileSync(join(root, "g"), "old toolchain\n")
    const first = await Jj.commit(root, "setup on the old toolchain")
    await Jj.setBookmark(root, "vibe", first)

    // Setup again on the upgrade: its commit replaces the earlier setup, a sideways move.
    await Jj.newAt(root, upgrade)
    writeFileSync(join(root, "g"), "new toolchain\n")
    const second = await Jj.commit(root, "setup on the new toolchain")
    await Jj.replaceBookmark(root, "vibe", second, upgrade)
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), second)

    // A recorded batch sits on the setup: a third setup would orphan it, so jj's refusal stands.
    writeFileSync(join(root, "h"), "batch\n")
    await Jj.newAt(root, second)
    writeFileSync(join(root, "h"), "batch\n")
    const batch = await Jj.commit(root, "migrate batch 01")
    await Jj.setBookmark(root, "vibe", batch)
    await Jj.newAt(root, upgrade)
    writeFileSync(join(root, "g"), "newer toolchain\n")
    const third = await Jj.commit(root, "setup on a newer toolchain")
    await assert.rejects(() => Jj.replaceBookmark(root, "vibe", third, upgrade))
    assert.equal(await Jj.bookmarkTarget(root, "vibe"), batch)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
