import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

test("alpha limitations are discoverable and link to current setup and resource guidance", () => {
  const page = new URL("../user/src/setup/known-limitations.md", import.meta.url)
  assert.ok(existsSync(page), "missing Known limitations page")
  const text = readFileSync(page, "utf8")
  const pin = JSON.parse(readFileSync(new URL("../../packages/runtime/package.json", import.meta.url), "utf8")).peerDependencies.effect
  for (const phrase of ["macOS arm64/x64", "Linux arm64/x64", "Windows arm64/x64", "effect@" + pin, "VS Code", "Cursor", "VSIX", "Marketplace", "Open VSX", "v0: breaking changes expected", "TS2307", "vibelang-ts-mapper", "experimental and unpublished", "tsc --runExternalCode"]) {
    assert.ok(text.includes(phrase), "missing limitation: " + phrase)
  }
  const bullets = text.split("\n").filter(line => line.startsWith("- "))
  assert.equal(bullets.length, 5)
  for (const bullet of bullets) {
    const link = /\]\(([^)]+)\)/.exec(bullet)?.[1]
    assert.ok(link, "each limitation links to its guide")
    assert.ok(existsSync(new URL(link.split("#")[0], page)), "missing link target: " + link)
  }
  assert.ok(readFileSync(new URL("../user/inventory.md", import.meta.url), "utf8").includes("[Known limitations](src/setup/known-limitations.md)"), "missing sidebar source entry")
  assert.ok(readFileSync(new URL("../../site/sidebar.ts", import.meta.url), "utf8").includes('"/setup/known-limitations"'), "missing generated sidebar entry")
})
