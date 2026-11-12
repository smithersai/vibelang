import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"

test("alpha limitations are discoverable and link to current setup and resource guidance", () => {
  const page = new URL("../user/src/setup/known-limitations.md", import.meta.url)
  assert.ok(existsSync(page), "missing Known limitations page")
  const text = readFileSync(page, "utf8")
  const pin = JSON.parse(readFileSync(new URL("../../packages/runtime/package.json", import.meta.url), "utf8")).peerDependencies.effect
  for (const phrase of ["macOS arm64/x64", "Linux arm64/x64", "Windows arm64/x64", "Bun runtime", "effect@" + pin, "VS Code", "Cursor", "VSIX", "Marketplace", "Open VSX", "v0: breaking changes expected", "allowArbitraryExtensions", ".d.vibe.ts", "vibelang-ts-mapper", "experimental and unpublished", "tsc --runExternalCode"]) {
    assert.ok(text.includes(phrase), "missing limitation: " + phrase)
  }
  // The platform list leads the page; later sections such as the specification's
  // compiler gaps keep their own lists and tests.
  const bullets = text.split("\n## ")[0].split("\n").filter(line => line.startsWith("- "))
  assert.equal(bullets.length, 6)
  for (const bullet of bullets) {
    const link = /\]\(([^)]+)\)/.exec(bullet)?.[1]
    assert.ok(link, "each limitation links to its guide")
    assert.ok(existsSync(new URL(link.split("#")[0], page)), "missing link target: " + link)
  }
  assert.ok(readFileSync(new URL("../user/inventory.md", import.meta.url), "utf8").includes("[Known limitations](src/setup/known-limitations.md)"), "missing sidebar source entry")
  assert.ok(readFileSync(new URL("../../site/sidebar.ts", import.meta.url), "utf8").includes('"/setup/known-limitations"'), "missing generated sidebar entry")
})

// The gate decides by what a reference resolves to (VIP-30, clarified
// 2026-11-12), so the page and its generated site copy hold one opt-in section,
// which names only what the check cannot see, and never the earlier claim that
// only direct uses are refused.
test("Known limitations has one experimental opt-in section that names each uncaught spelling", () => {
  for (const rel of ["../user/src/setup/known-limitations.md", "../../site/src/pages/setup/known-limitations.mdx"]) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8")
    assert.equal(text.match(/^## The experimental opt-in$/gm)?.length, 1, rel + ": one experimental opt-in section")
    assert.ok(!text.includes("the direct uses of the eight experimental modules"), rel + ": no direct-uses-only claim")
    assert.ok(!text.includes("It does not yet catch an alias"), rel + ": no stale alias limitation")
    assert.ok(!text.includes("refuses every use in a `.vibe` or `.vibex` file that resolves"), rel + ": no claim that every resolved use is refused")
    // Each spelling the check misses until the compiler covers it; the compiler
    // fix removes them from the page and from this list together.
    for (const spelling of [
      "`let D; ({ Durable: D } = Experimental)`",
      '`const { ["Durable"]: D } = Experimental`',
      '`Experimental[k]` where `k: "Durable" | "Fuzz"`',
      "`Object.entries(Experimental)`",
      '`import { $task } from "vibelang-runtime/internal"`',
      '`import { memory } from "./node_modules/vibelang-runtime/dist/experimental/Durable.js"`',
    ]) assert.ok(text.includes(spelling), rel + ": names the uncaught spelling " + spelling)
  }
})
