// Chapter 004 reference twin: the TypeScript 5.9.3 / Effect 4.1.0 cache install.
import assert from "node:assert/strict"
import { test } from "node:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { installReference } from "./test/cov-ch004-twin.mjs"

function fakeInstall(prefix) {
  fs.mkdirSync(path.join(prefix, "node_modules/typescript"), { recursive: true })
  fs.writeFileSync(path.join(prefix, "node_modules/typescript/package.json"), '{"version":"5.9.3"}')
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cov-ch004-reference-test-"))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, cache: path.join(root, "cov-ch004-reference") }
}

test("a reference cache left without node_modules by an interrupted install is replaced", t => {
  const { root, cache } = fixture(t)
  fs.mkdirSync(cache)
  fs.writeFileSync(path.join(cache, "package.json"), "{}")
  let installs = 0
  assert.equal(installReference(cache, prefix => { installs++; fakeInstall(prefix) }), path.join(cache, "node_modules"))
  assert.equal(installs, 1)
  assert.ok(fs.existsSync(path.join(cache, "node_modules/typescript/package.json")))
  assert.deepEqual(fs.readdirSync(root), ["cov-ch004-reference"], "no staging copy stays behind")
})

test("an installed reference cache is reused without installing", t => {
  const { cache } = fixture(t)
  fakeInstall(cache)
  let installs = 0
  assert.equal(installReference(cache, () => { installs++ }), path.join(cache, "node_modules"))
  assert.equal(installs, 0)
})

test("a failing install leaves no staging copy and no cache", t => {
  const { root, cache } = fixture(t)
  assert.throws(() => installReference(cache, () => { throw new Error("npm failed") }), /npm failed/)
  assert.deepEqual(fs.readdirSync(root), [])
})
