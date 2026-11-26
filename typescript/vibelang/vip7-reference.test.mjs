import test from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { referenceModules } from "./test/vip7-reference.mjs"

test("standalone runners consume a prepared stock reference without creating or repairing an install", t => {
  const directory = mkdtempSync(join(tmpdir(), "vip7-reference-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const modules = join(directory, "node_modules")
  assert.throws(() => referenceModules(modules), /smthrs build \/\/typescript\/vibelang:stock-reference/)
  assert.deepEqual(readdirSync(directory), [])

  function manifest(name, version) {
    const pkg = join(modules, name)
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ version }))
  }
  manifest("effect", "4.1.0")
  assert.equal(referenceModules(modules, ["effect"]), modules)
  assert.throws(() => referenceModules(modules), /Cannot read .*typescript/)
  manifest("typescript", "5.9.2")
  assert.throws(() => referenceModules(modules), /Expected typescript@5.9.3.*found 5.9.2/)
  manifest("typescript", "5.9.3")
  assert.equal(referenceModules(modules), modules)
})
