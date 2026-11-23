import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("./src/", import.meta.url))
const read = page => readFileSync(join(root, page), "utf8")
const pages = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? pages(path) : entry.name.endsWith(".md") ? [relative(root, path)] : []
})
const guides = pages(root).filter(page => page !== "setup/release-notes.md")

test("published examples have no pending headers", () => {
  const marker = /^[ \t]*\/\/ pending(?:-decision)?:/m
  assert.deepEqual(guides.filter(page => marker.test(read(page))), [])
})

test("published guides keep checkout automation and VibeLang quick fixes out of user instructions", () => {
  const internal = /\b(?:the (?:repository )?migrat(?:e|ion) flow|migration setup)\b|--route-bundled-imports|--emitted-project|\.vibelang\/toolchain-publication\.json/i
  const fix = /\beditor action\b|\bthe (?:fixer|repair) (?:writes|captures|preserves)\b|\bApply its repair\b/i
  assert.deepEqual(guides.filter(page => internal.test(read(page)) || fix.test(read(page))), [])
})

test("setup uses Bun 1.4.2 as the minimum when Bun is optional", () => {
  for (const page of ["001-onboarding.md", "013-getting-started.md", "getting-started/004-installation.md", "setup.md"]) {
    const text = read(page)
    assert.match(text, /1\.4\.2/, page)
    assert.doesNotMatch(text, /\b1\.4(?:\.[01])?`? or later\b/, page)
  }
})

test("Vitest uses the starter test project and Devtools documents shipped lint integrations", () => {
  const devtools = read("getting-started/012-devtools.md")
  const starter = readFileSync(new URL("../../templates/app/vitest.config.ts", import.meta.url), "utf8")
  const config = starter.match(/vibelang\(\{ project: "tsconfig\.test\.json" \}\)/)?.[0]
  assert.ok(config, "expected the starter to select its test project")
  assert.ok(devtools.includes(config), "the Devtools example must select the test project")
  assert.match(devtools, /vibelang\/oxlint/)
})
