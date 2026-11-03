import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("severities recover effective entries independently after extends merging", () => {
  const text = chapter("007-tooling")
  assert.match(text, /Merge `extends` before validating each effective severity entry/)
  assert.match(text, /invalid child entry.*displaces its inherited entry without restoring it/)
  assert.match(text, /valid entries and independent options still apply/)
  assert.match(text, /language-service setting.*default/)
  assert.match(text, /Configuration errors keep.*exit.*emit/)
})

test("the public VIP and user CLI guide publish the same recovery rule", () => {
  for (const path of ["docs/design/vips/0030-config-files.md", "docs/user/src/setup/vibelang-cli.md"]) {
    const text = read(path)
    assert.match(text, /effective (?:severity )?entr/, path)
    assert.match(text, /does not restore.*base entry/, path)
    assert.match(text, /EK3006/, path)
  }
})

test("the example distinguishes overwritten codes from unaffected inherited entries", () => {
  const text = chapter("007-tooling")
  const marker = text.indexOf("// Effective-entry recovery")
  assert.ok(marker >= 0, "missing inherited invalid-child example")
  const end = text.indexOf("```", marker)
  const configs = text.slice(marker, end).split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line))
  assert.equal(configs.length, 2)
  assert.equal(configs[0].vibe.severities.EK0801, "error")
  assert.equal(configs[1].vibe.severities.EK0801, "bad")
  assert.equal(configs[0].vibe.severities.EK4609, "off")
  assert.equal(configs[1].vibe.severities.EK0508, "off")
})
