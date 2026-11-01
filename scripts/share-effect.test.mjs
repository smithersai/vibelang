import assert from "node:assert/strict"
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { share } from "./share-effect.mjs"

function fixture(t, packages) {
  const root = mkdtempSync(path.join(tmpdir(), "share-effect-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [dir, version] of Object.entries(packages)) {
    mkdirSync(path.join(root, dir), { recursive: true })
    writeFileSync(path.join(root, dir, "package.json"), JSON.stringify({ version }))
  }
  return root
}

const copies = {
  "experiments/node_modules/effect": "4.1.1",
  "experiments/node_modules/@effect/platform-node": "4.1.1",
  "packages/runtime/node_modules/effect": "4.1.1",
  "packages/runtime/node_modules/@effect/platform-node": "4.1.1",
  "packages/runtime/node_modules/fast-check": "4.0.0"
}

// Hosted pre-gates on 2026-10-31 failed 22 compiler tests with TS2883 on an
// error declaration: effect lay under the fixture's vibelang-runtime link.
test("the runtime reads the experiments copy, and no Effect package stays beneath it", (t) => {
  const root = fixture(t, copies)
  assert.deepEqual(share(root).sort(), ["@effect/platform-node", "effect"])
  for (const name of ["effect", "@effect/platform-node"]) {
    assert.equal(realpathSync(path.join(root, "packages/runtime/node_modules", name)), realpathSync(path.join(root, "experiments/node_modules", name)))
  }
  assert.ok(!path.isAbsolute(readlinkSync(path.join(root, "packages/runtime/node_modules/effect"))), "a checkout can move")
  assert.ok(lstatSync(path.join(root, "packages/runtime/node_modules/fast-check")).isDirectory(), "other packages stay")
})

test("a second run links nothing", (t) => {
  const root = fixture(t, copies)
  share(root)
  assert.deepEqual(share(root), [])
})

test("a package at another version stays", (t) => {
  const root = fixture(t, { ...copies, "experiments/node_modules/effect": "4.2.0" })
  assert.deepEqual(share(root), ["@effect/platform-node"])
  assert.ok(lstatSync(path.join(root, "packages/runtime/node_modules/effect")).isDirectory())
})

test("a shared install and a missing install are left alone", (t) => {
  const shared = fixture(t, { "experiments/node_modules/effect": "4.1.1", "store/node_modules/effect": "4.1.1", "packages/runtime/keep": "1" })
  symlinkSync(path.join(shared, "store/node_modules"), path.join(shared, "packages/runtime/node_modules"))
  assert.deepEqual(share(shared), [])
  assert.ok(lstatSync(path.join(shared, "store/node_modules/effect")).isDirectory())
  assert.deepEqual(share(fixture(t, { "packages/runtime/node_modules/effect": "4.1.1" })), [])
})
