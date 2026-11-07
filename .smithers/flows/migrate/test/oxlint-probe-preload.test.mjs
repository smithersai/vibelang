import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    assert.equal(blanketReasonPolicy(tool), true)
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
  assert.throws(() => blanketReasonPolicy(tool), error =>
    /status 7/.test(error.message) && /probe-fixture-failure/.test(error.message))
})
