import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8")
const gate = () => read(".github/workflows/mq-pregate.yml")

test("pre-gate guidance follows the contribution base and keeps green toolchains", () => {
  const agents = read("AGENTS.md")
  assert.match(agents, /Base new work on `vibe`/)
  assert.match(agents, /Build toolchains from `main` unless/)
  const guide = read("docs/maintainers/build.md").split("## The merge queue's pre-gate\n")[1]?.split("\nThe hosted workflow installs Chromium")[0]
  assert.ok(guide, "pre-gate guidance is present")
  assert.match(guide, /base new work on `vibe`/i)
  assert.match(guide, /full base commit id/i)
  assert.match(guide, /-f base=<full-base-commit-id>/)
  assert.doesNotMatch(guide, /current `main`|commit (?:of|on) `?main`?|base=<commit on main>/i)
  assert.doesNotMatch(guide, /tests every queued change|only changes that passed/i)
})

test("hosted pre-gate descriptions accept the supplied base without a branch restriction", () => {
  const yml = gate()
  const description = yml.match(/^      base:\n        description: (.+)$/m)?.[1]
  assert.ok(description, "manual dispatch documents its base input")
  assert.match(description, /full commit id/i)
  assert.doesNotMatch(description, /\bon (?:main|vibe)\b/i)
  const comment = yml.match(/^# One queued change,[\s\S]*?(?=^on:)/m)?.[0]
  assert.ok(comment, "the pre-gate has a dispatch description")
  assert.match(comment, /supplied/)
  assert.doesNotMatch(comment, /\b(?:main|vibe) at `base`/)
})

test("both hosted dispatch paths carry the same base into checkout and gate selection", () => {
  const yml = gate()
  assert.match(yml, /^  PRE_BASE: \$\{\{ github\.event\.client_payload\.base \|\| inputs\.base \}\}$/m)
  assert.match(yml, /^          ref: \$\{\{ env\.PRE_BASE \}\}$/m)
  assert.match(yml, /CI_GATE_BASE="\$PRE_BASE"/)
  const apply = yml.indexOf("- name: Apply the change")
  const run = yml.indexOf("- name: Gate\n")
  assert.ok(apply > 0 && run > apply, "the supplied patch is applied before target execution")
  assert.match(yml.slice(apply, run), /printf '%s' "\$PRE_PATCH" \| sh scripts\/apply-patch\.sh/)
})
