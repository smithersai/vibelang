import assert from "node:assert/strict"
import { existsSync, readFileSync, mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// Main installs the browser unconditionally. Keep that baseline executable so
// the workflow regression has a real before/after result before the helper exists.
const helper = new URL("./ci-browser-needed.mjs", import.meta.url)
const { classifyPlan, browserPrerequisites } = existsSync(helper)
  ? await import(helper.href)
  : { classifyPlan: () => true }
const root = new URL("../", import.meta.url).pathname
const workflow = readFileSync(new URL("../.github/workflows/mq-pregate.yml", import.meta.url), "utf8")
const node = (label, dependencies = [], target = "Shell.Test") => ({ label, dependencies, target })
const plan = (targets, roots = ["//:release"]) => ({ roots, targets, warnings: [] })

for (const label of ["//:release", "//:tokens", "//:spec-tests", "//packages:compiler-test"]) {
  test(`verified ${label} omits browser setup`, () => {
    assert.equal(classifyPlan(label, plan([node(label)], [label])), false)
  })
}

test("a known selection retains browser setup through every dependency depth", () => {
  for (let depth = 0; depth < 8; depth++) {
    const labels = ["//:release", "//:tokens", "//:spec-tests", "//:docs-tools", "//:docs-check", "//:snippets", "//packages:compiler-test", "//packages:runtime-test"].slice(0, depth + 1)
    const targets = labels.map((label, i) => node(label, [labels[i + 1] ?? "//:site-contrast"]))
    targets.push(node("//:site-contrast"))
    assert.equal(classifyPlan("//:release", plan(targets)), true)
  }
})

test("defaults, wildcards, options and unfamiliar labels retain browser setup", () => {
  for (const selector of ["", "  \n", "//...", "//:*", "//:rele*", ":release", "--jobs 8", "//:release --no-cache", "//new:check", "//:site-contrast"]) {
    assert.equal(classifyPlan(selector, plan([node("//:release")])), true, selector)
  }
})

test("incomplete, conflicting and unfamiliar plans retain browser setup", () => {
  for (const value of [null, {}, {targets:[]}, plan([]), plan([node("//:tokens")]),
    plan([node("//:release", ["//missing:target"])]),
    plan([node("//:release"), node("//:release", ["//:site-contrast"])]),
    plan([node("//:release", ["//new:check"]), node("//new:check")]),
    plan([node("//:release", [], "New.Rule")]),
    plan([node("//:release")], ["//:tokens"]),
    {...plan([node("//:release")]),warnings:["incomplete"]},
    plan([node("//:release", "not-an-array")]),
    plan([node("//:release", ["//:tokens"]), node("//:tokens", ["//:release"])])]) {
    assert.equal(classifyPlan("//:release", value), true, JSON.stringify(value))
  }
})

test("generated known dependency graphs retain browser and unknown descendants", () => {
  const labels = ["//:release", "//:tokens", "//:spec-tests", "//:docs-tools", "//:docs-check", "//:snippets", "//packages:compiler-test", "//packages:runtime-test"]
  let seed = 114
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
  for (let i = 0; i < 256; i++) {
    const length = 1 + random(labels.length)
    const targets = labels.slice(0, length).map((label, index) => node(label, index + 1 < length ? [labels[index + 1]] : []))
    const selectors = [...new Set([labels[0], labels[random(length)]])]
    const selected = selectors.join([" ", "\t", "\n", "  \n\t"][random(4)])
    const fixture = plan(targets, selectors)
    assert.equal(classifyPlan(selected, fixture), false)
    const leaf = targets.at(-1)
    for (const name of ["//:site-contrast", "//future:browser"]) {
      const changed = structuredClone(fixture)
      changed.targets.at(-1).dependencies.push(name)
      changed.targets.push(node(name))
      assert.equal(classifyPlan(selected, changed), true)
    }
    assert.deepEqual(leaf.dependencies, [], "classification must not mutate the plan")
  }
})

test("hosted browser installation uses the real selector output", () => {
  const select = workflow.match(/      - name: Select browser prerequisites\n([\s\S]*?)(?=\n      - )/)
  assert.ok(select, "missing browser selection step")
  assert.match(select[1], /^        id: browser$/m)
  assert.match(select[1], /cd \.smithers && bun install --frozen-lockfile/)
  assert.match(select[1], /node scripts\/ci-browser-needed\.mjs >> "\$GITHUB_OUTPUT"/)
  const install = workflow.match(/      - name: Install Chromium\n([\s\S]*?)(?=\n      - |\n      #)/)
  assert.match(install[1], /^        if: steps\.browser\.outputs\.needed == 'true'$/m)
  assert.match(install[1], /npm ci --no-audit --no-fund/)
  assert.match(install[1], /npx playwright install --with-deps chromium/)
})

test("the actual planner preserves an indirect browser prerequisite", { skip: !browserPrerequisites }, t => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-browser-plan-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  symlinkSync(join(root, ".smithers/node_modules"), join(dir, "node_modules"), "dir")
  const workspace = readFileSync(join(root, ".smithers/WORKSPACE.ts"), "utf8").replaceAll("//.smithers/package.json", "//package.json")
  writeFileSync(join(dir, "WORKSPACE.ts"), workspace)
  for (const name of ["package.json", "bun.lock"]) writeFileSync(join(dir, name), readFileSync(join(root, ".smithers", name)))
  const source = browser => `import { Smithers as S } from "@smthrs/targets"
const browser = S.Shell.Test({shell:"touch must-not-run",sandbox:"none"})
const inner = S.Shell.Test({shell:"true",sandbox:"none",data:${browser ? "[browser]" : "[]"}})
const outer = S.Shell.Test({shell:"true",sandbox:"none",data:[inner]})
export const Package = S.Package({targets:{release:outer,tokens:inner,"site-contrast":browser}})
`
  writeFileSync(join(dir, "PACKAGE.ts"), source(false))
  assert.deepEqual(browserPrerequisites("//:release", dir), { needed: false, reason: "verified non-browser dependency plan" })
  writeFileSync(join(dir, "PACKAGE.ts"), source(true))
  assert.equal(browserPrerequisites("//:release", dir).needed, true)
  writeFileSync(join(dir, "PACKAGE.ts"), "invalid declaration")
  assert.equal(browserPrerequisites("//:release", dir).needed, true)
  assert.equal(existsSync(join(dir, "must-not-run")), false, "planning must never execute a target")
})
