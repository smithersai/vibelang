import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { absolutePaths, addedLines, assertPortable, machineRoots } from "../lib/portable.mjs"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"

test("absolutePaths finds the machine's roots and absolute file: specifiers", () => {
  const roots = ["/srv/run", "/srv/run/toolchain"]
  assert.deepEqual(absolutePaths('"vibelang": "file:/srv/run/toolchain/vibelang-0.0.11.tgz"', roots), ["/srv/run/toolchain", "/srv/run", "file:/srv/run/toolchain/vibelang-0.0.11.tgz"])
  assert.deepEqual(absolutePaths('"vibelang": "file:../../.vibelang-toolchain/vibelang-0.0.11.tgz"', roots), [])
  assert.deepEqual(absolutePaths("/** Absolute file:// preload URL; null requires disabling element picking. */", roots), [])
  assert.deepEqual(absolutePaths('"file:///srv/other/x.tgz"', roots), ["file:///srv/other/x.tgz"])
  assert.deepEqual(absolutePaths("link:/opt/vibelang/packages/compiler", []), ["link:/opt/vibelang/packages/compiler"])
  assert.ok(machineRoots("/a", undefined).includes(homedir()))
})

test("addedLines reads the added lines of a Git-format diff with their line numbers", () => {
  const diff = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+more", "diff --git a/y b/y", "--- /dev/null", "+++ b/y", "@@ -0,0 +1 @@", "+y"].join("\n")
  assert.deepEqual(addedLines(diff), [{ file: "x", line: 2, text: "new" }, { file: "x", line: 3, text: "more" }, { file: "y", line: 1, text: "y" }])
})

// The guard every commit of the flow passes: a committed file must not name an absolute path of this machine.
test("assertPortable refuses a change that commits an absolute path, and accepts relative ones", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-portable-"))
  try {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    mkdirSync(join(root, "packages/p"), { recursive: true })
    writeFileSync(join(root, "packages/p/package.json"), JSON.stringify({ devDependencies: { vibelang: `file:${join(root, ".vibelang-toolchain/vibelang-0.0.11.tgz")}` } }))
    await assert.rejects(assertPortable(root, machineRoots(root)), /absolute paths of this machine:\n- packages\/p\/package.json:1: /)
    writeFileSync(join(root, "packages/p/package.json"), JSON.stringify({ devDependencies: { vibelang: "file:../../.vibelang-toolchain/vibelang-0.0.11.tgz" } }))
    await assertPortable(root, machineRoots(root))
    assert.ok(await Jj.commit(root, "relative"))
    writeFileSync(join(root, "notes.md"), `built in ${homedir()}/somewhere\n`)
    await assert.rejects(assertPortable(root, machineRoots(root)), /notes.md:1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
