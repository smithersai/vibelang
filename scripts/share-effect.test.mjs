import assert from "node:assert/strict"
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
const { share } = await import(process.env.VIBELANG_SHARE_EFFECT_MODULE ?? new URL("./share-effect.mjs", import.meta.url))

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

// A scope symlink is a provisioned shared install, just like a symlinked
// node_modules. Never delete packages through it, even when pins agree.
const snapshot = directory => readdirSync(directory).sort().map(name => {
  const file = path.join(directory, name)
  const stat = lstatSync(file)
  return [name, stat.isSymbolicLink() ? ["link", readlinkSync(file)]
    : stat.isDirectory() ? snapshot(file) : ["file", readFileSync(file, "utf8")]]
})

for (const kind of ["absolute", "relative", "dangling"]) {
  for (const contents of ["populated", "empty"]) {
    test("shared Effect scope stays provisioned: " + kind + ", " + contents, t => {
      const root = fixture(t, copies)
      const alias = path.join(root, "packages/runtime/node_modules/@effect")
      const store = path.join(root, "shared installation/@effect")
      mkdirSync(path.dirname(store), { recursive: true })
      renameSync(alias, store)
      if (contents === "empty") rmSync(path.join(store, "platform-node"), { recursive: true })
      else writeFileSync(path.join(store, "platform-node/user-content.txt"), "retained shared package")
      writeFileSync(path.join(store, "owner.txt"), "provisioned by owner")
      const destination = kind === "dangling" ? path.join(root, "not installed/@effect") : store
      const target = kind === "relative" ? path.relative(path.dirname(alias), destination) : destination
      symlinkSync(target, alias)
      const original = snapshot(path.dirname(store))
      const source = snapshot(path.join(root, "experiments/node_modules"))
      for (let i = 0; i < 2; i++) {
        const linked = share(root)
        assert.equal(readlinkSync(alias), target)
        assert.deepEqual(snapshot(path.dirname(store)), original, "the shared installation changed")
        assert.deepEqual(linked, i === 0 ? ["effect"] : [])
        assert.deepEqual(snapshot(path.join(root, "experiments/node_modules")), source)
        assert.equal(realpathSync(path.join(root, "packages/runtime/node_modules/effect")), realpathSync(path.join(root, "experiments/node_modules/effect")))
      }
    })
  }
}

test("an aliased source scope can still supply a private runtime scope", t => {
  const root = fixture(t, copies)
  const source = path.join(root, "experiments/node_modules/@effect")
  const store = path.join(root, "source installation/@effect")
  mkdirSync(path.dirname(store), { recursive: true })
  renameSync(source, store)
  symlinkSync(path.relative(path.dirname(source), store), source)
  const original = snapshot(store)
  assert.deepEqual(share(root).sort(), ["@effect/platform-node", "effect"])
  assert.equal(realpathSync(path.join(root, "packages/runtime/node_modules/@effect/platform-node")), realpathSync(path.join(store, "platform-node")))
  assert.deepEqual(snapshot(store), original)
})

test("an output scope pointing at the input installation cannot delete its packages", t => {
  const root = fixture(t, copies)
  const alias = path.join(root, "packages/runtime/node_modules/@effect")
  const source = path.join(root, "experiments/node_modules")
  rmSync(alias, { recursive: true })
  symlinkSync(path.relative(path.dirname(alias), path.join(source, "@effect")), alias)
  const original = snapshot(source)
  const linked = share(root)
  assert.deepEqual(snapshot(source), original, "the input installation changed")
  assert.deepEqual(linked, ["effect"])
  assert.equal(realpathSync(path.join(alias, "platform-node")), realpathSync(path.join(source, "@effect/platform-node")))
})
