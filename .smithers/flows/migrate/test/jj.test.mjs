import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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

// Route-group folders (app/(auth)/login.ts) and names with ~ | & are paths, not fileset expressions.
test("paths with fileset operators are read, listed and restored as literal files", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-jj-literal-"))
  const files = { "src/plain.ts": "export const p = 1\n", "app/(auth)/login.ts": "export const login = 1\n", "src/a~b.ts": "export const c = 1\n", "src/x|y&z.ts": "export const d = 1\n" }
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    for (const [file, text] of Object.entries(files)) put(file, text)
    const base = await Jj.commit(root, "base")
    for (const [file, text] of Object.entries(files)) {
      assert.equal(await Jj.fileAt(root, base, file), text, file)
      assert.equal(await Jj.fileAt(root, "@", file), text, file)
    }
    assert.deepEqual(await Jj.filesAt(root, base, "app/(auth)"), ["app/(auth)/login.ts"])
    for (const file of Object.keys(files)) put(file, "changed\n")
    put("app/(auth)/new~file.ts", "added after base\n")
    await Jj.restore(root, base, [...Object.keys(files), "app/(auth)/new~file.ts"])
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(join(root, file), "utf8"), text, file)
    assert.ok(!existsSync(join(root, "app/(auth)/new~file.ts")), "a path absent at the revision is removed")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an absent path is null or empty, and a jj failure is an error", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-jj-absent-")), outside = mkdtempSync(join(tmpdir(), "migrate-jj-none-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/plain.ts"), "export const p = 1\n")
    const base = await Jj.commit(root, "base")
    assert.equal(await Jj.fileAt(root, base, "src/missing.ts"), null)
    assert.equal(await Jj.fileAt(root, base, "src/plain.ts~src/plain.ts"), null, "a set difference is a file name")
    assert.deepEqual(await Jj.filesAt(root, base, "nodir"), [])
    assert.equal(await Jj.bookmarkTarget(root, "absent"), null)
    await assert.rejects(Jj.fileAt(root, "nosuchrev", "src/plain.ts"), /nosuchrev/)
    await assert.rejects(Jj.filesAt(root, "nosuchrev", "src"), /nosuchrev/)
    await assert.rejects(Jj.restore(root, "nosuchrev", ["src/plain.ts"]), /nosuchrev/)
    await assert.rejects(Jj.bookmarkTarget(outside, "vibe"), /no jj repo/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
