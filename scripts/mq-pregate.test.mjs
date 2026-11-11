import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
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

const warm = () => read(".github/workflows/go-cache.yml")
const cacheSteps = yml => yml.split(/(?=^      - )/m)
  .filter(step => /uses: actions\/cache(?:\/(?:restore|save))?@/.test(step))
const cacheKey = step => step.match(/^          key: (.+)$/m)?.[1]
const cachePaths = yml => yml.match(/^  CACHE_PATHS: \|\n((?:    ~[^\n]+\n)+)/m)?.[1]

test("the hosted pre-gate can only restore caches", () => {
  const caches = cacheSteps(gate())
  assert.equal(caches.length, 2, "dependency and graph Go caches are restored")
  for (const step of caches) {
    assert.match(step, /uses: actions\/cache\/restore@[a-f0-9]{40}\b/,
      "unreviewed code must never publish a cache, including through the combined action")
  }
})

test("only the trusted main job writes each cache family restored by the pre-gate", () => {
  const trusted = warm()
  assert.match(trusted, /^  push:\n    branches: \[main\]$/m)
  assert.match(trusted, /^  warm:\n    if: github\.ref == 'refs\/heads\/main'$/m,
    "manual runs from other refs cannot write trusted caches")
  assert.doesNotMatch(trusted, /repository_dispatch|pull_request/)
  assert.deepEqual([...trusted.split(/^jobs:\n/m)[1].matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]), ["warm"])
  assert.doesNotMatch(trusted, /continue-on-error:|always\(\)|failure\(\)/)
  const checkout = trusted.split(/(?=^      - )/m).find(step => /uses: actions\/checkout@/.test(step))
  assert.ok(checkout)
  assert.doesNotMatch(checkout, /^          ref:/m, "checkout keeps the trusted event's commit")

  const restored = cacheSteps(gate())
  for (const step of restored) {
    const prefix = step.match(/^          restore-keys: (.+)$/m)?.[1]
    assert.ok(prefix)
    const writers = readdirSync(new URL("../.github/workflows/", import.meta.url))
      .filter(file => /\.ya?ml$/.test(file))
      .flatMap(file => cacheSteps(read(".github/workflows/" + file))
        .filter(cache => !/uses: actions\/cache\/restore@/.test(cache) && cacheKey(cache)?.startsWith(prefix))
        .map(cache => ({ file, cache })))
    assert.equal(writers.length, 1, prefix + " has exactly one writer")
    assert.equal(writers[0].file, "go-cache.yml")
    assert.ok(trusted.indexOf(writers[0].cache) > trusted.indexOf("  warm:\n"))
    assert.doesNotMatch(writers[0].cache, /always\(\)|failure\(\)|continue-on-error:/,
      "failed or partial warmups must not publish")
  }
})

test("trusted dependency caches use a fresh namespace with identical save and restore paths", () => {
  const trusted = warm()
  const daily = yml => cacheSteps(yml).filter(step => cacheKey(step)?.startsWith("gate-"))
  const restores = daily(gate())
  const trustedCaches = daily(trusted)
  assert.equal(restores.length, 1)
  assert.equal(trustedCaches.length, 2)
  for (const step of [...restores, ...trustedCaches]) {
    assert.equal(cacheKey(step), "gate-trusted-v1-${{ steps.day.outputs.day }}")
    assert.match(step, /^          path: \$\{\{ env\.CACHE_PATHS \}\}$/m)
    if (/uses: actions\/cache\/restore@/.test(step)) {
      assert.match(step, /^          restore-keys: gate-trusted-v1-$/m,
        "never fall back to the old patch-written cache namespace")
    }
  }
  assert.ok(cachePaths(gate()))
  assert.equal(cachePaths(trusted), cachePaths(gate()), "cache versions include their paths")
  const save = trustedCaches.find(step => /uses: actions\/cache\/save@/.test(step))
  assert.ok(save)
  const saveAt = trusted.indexOf(save)
  for (const install of ["sh scripts/ci.sh --prepare-only", "npm ci --no-audit --no-fund",
    "npx playwright install --with-deps chromium", "sh scripts/warm-go-cache.sh"]) {
    const index = trusted.indexOf(install)
    assert.ok(index > 0 && index < saveAt, install + " finishes before publishing the cache")
  }
})

test("hosted cache workflows keep actions pinned and repository access read-only", () => {
  for (const yml of [gate(), warm()]) {
    assert.match(yml, /^permissions:\n  contents: read\n/m)
    assert.doesNotMatch(yml, /^[ \t]+permissions:/m, "jobs cannot broaden token access")
    for (const action of yml.matchAll(/^\s+(?:- )?uses: (.+)$/gm)) {
      assert.match(action[1], /^[\w./-]+@[a-f0-9]{40}$/)
    }
    assert.match(yml, /^          persist-credentials: false$/m)
    assert.match(yml, /^          cache: false$/m, "setup-go cannot write an implicit cache")
  }
})
