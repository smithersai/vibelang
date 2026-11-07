import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { blanketReasonPolicy } from "../templates/oxlint-comments.mjs"

test("the isolated Oxlint probe removes its source preload and retains other Node options", t => {
  const root = mkdtempSync(join(tmpdir(), "oxlint-probe-preload-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tool = join(root, "engine"), observed = join(root, "options.json")
  writeFileSync(tool, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(' + JSON.stringify(observed) +
    ', JSON.stringify(process.env.NODE_OPTIONS)); console.log(JSON.stringify({diagnostics:[]}));\n')
  chmodSync(tool, 0o755)
  const previous = process.env.NODE_OPTIONS
  try {
    process.env.NODE_OPTIONS = "--no-warnings --import=vibelang/register"
    assert.equal(blanketReasonPolicy(process.execPath, [tool]), true)
    assert.equal(JSON.parse(readFileSync(observed, "utf8")), "--no-warnings")
  } finally {
    if (previous === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previous
  }
})

test("an Oxlint probe failure names the native status and diagnostic", t => {
  const root = mkdtempSync(join(tmpdir(), "oxlint-probe-failure-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tool = join(root, "engine")
  writeFileSync(tool, '#!/usr/bin/env node\nconsole.error("probe-fixture-failure");process.exit(7);\n')
  chmodSync(tool, 0o755)
  assert.throws(() => blanketReasonPolicy(process.execPath, [tool]), error =>
    /status 7/.test(error.message) && /probe-fixture-failure/.test(error.message))
})

test("the directive probe resolves other package preloads from its caller", t => {
  const root = mkdtempSync(join(tmpdir(), "oxlint-probe-package-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const module = join(root, "node_modules/project-preload")
  mkdirSync(module, { recursive: true })
  writeFileSync(join(module, "package.json"), '{"name":"project-preload","type":"module","exports":"./index.mjs"}')
  writeFileSync(join(module, "index.mjs"), "globalThis.projectPreloaded = true")
  const tool = join(root, "engine.cjs")
  writeFileSync(tool, 'if(!globalThis.projectPreloaded)process.exit(8); console.log(JSON.stringify({diagnostics:[]}));')
  const previousDirectory = process.cwd(), previousOptions = process.env.NODE_OPTIONS
  try {
    process.chdir(root)
    process.env.NODE_OPTIONS = "--import=project-preload --no-warnings"
    assert.equal(blanketReasonPolicy(process.execPath, [tool]), true)
  } finally {
    process.chdir(previousDirectory)
    if (previousOptions === undefined) delete process.env.NODE_OPTIONS
    else process.env.NODE_OPTIONS = previousOptions
  }
})
