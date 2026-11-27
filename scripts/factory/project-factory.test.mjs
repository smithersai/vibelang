import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../../", import.meta.url))
const allowedCloudRealmModules = new Set([
  "@smthrs/flow",
  "@smthrs/plan",
  "@smthrs/sandbox",
  "effect"
])

test("every .smithers/workflows/*.ts imports only the four QuickJS realm SDK modules", () => {
  const dir = join(repoRoot, ".smithers/workflows")
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()
  assert.ok(files.length >= 4, `expected at least 4 cloud workflows, found ${files.length}`)
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8")
    const imports = [...source.matchAll(/^\s*import\s+[\s\S]*?\s+from\s+["']([^"']+)["']/gm)].map((m) => m[1])
    assert.ok(imports.length > 0, `${file} must import @smthrs/flow`)
    for (const mod of imports) {
      assert.ok(
        allowedCloudRealmModules.has(mod),
        `${file} imports forbidden module '${mod}' outside Smithers Cloud QuickJS realm allowlist`
      )
    }
  }
})

test(".smithers/factory.json preserves full apostrophe descriptions and kind: vibe for .vibe flows", () => {
  const factoryJson = JSON.parse(readFileSync(join(repoRoot, ".smithers/factory.json"), "utf8"))
  const byId = new Map(factoryJson.flows.map((f) => [f.id, f]))

  const firstBad = byId.get("first-bad")
  assert.ok(firstBad, "missing first-bad flow")
  assert.equal(firstBad.kind, "vibe")

  const ciHealth = byId.get("ci-health")
  assert.ok(ciHealth, "missing ci-health flow")
  assert.ok(ciHealth.description.includes("graph's slow"), `truncated description: ${ciHealth.description}`)

  const docs = byId.get("docs")
  assert.ok(docs, "missing docs flow")
  assert.ok(docs.description.includes("doc's tokens"), `truncated description: ${docs.description}`)

  assert.equal(factoryJson.github.mirror, "push")
  assert.equal(factoryJson.github.issues, "two-way")
  assert.equal(factoryJson.github.changes, "land")
  assert.ok(factoryJson.github.maintainers.includes("roninjin10"))
  for (const protectedPath of [".smithers/**", ".github/workflows/**", "scripts/release/**", "WORKSPACE.ts", "PACKAGE.ts"]) {
    assert.ok(factoryJson.github.protectedPaths.includes(protectedPath), `missing protectedPath ${protectedPath}`)
  }
})

test(".smithers/home.json personalizes Maintainer, Contributor (role), and Viewer audiences cleanly", () => {
  const home = JSON.parse(readFileSync(join(repoRoot, ".smithers/home.json"), "utf8"))
  assert.equal(home.contributors, "role")
  const audiences = home.sections.map((s) => s.audience)
  assert.deepEqual(audiences, ["maintainer", "contributor", "everyone"])

  const maintainerBlocks = home.sections[0].blocks
  assert.ok(maintainerBlocks.some((b) => b.type === "action" && b.flow === "branch.new"))
  assert.ok(maintainerBlocks.some((b) => b.type === "action" && b.flow === "uphill"))
  assert.ok(maintainerBlocks.some((b) => b.type === "action" && b.flow === "wiki"))
  assert.ok(maintainerBlocks.some((b) => b.type === "issues"))
  assert.ok(maintainerBlocks.some((b) => b.type === "stack"))
  assert.ok(maintainerBlocks.some((b) => b.type === "runs"))
  assert.ok(maintainerBlocks.some((b) => b.type === "flows"))

  const contributorBlocks = home.sections[1].blocks
  assert.ok(contributorBlocks.some((b) => b.type === "text" && /read-only/i.test(b.text)))

  const viewerBlocks = home.sections[2].blocks
  const factoryCards = viewerBlocks.find((b) => b.type === "cards" && b.title === "Public Smithers Cloud Factory")
  assert.ok(factoryCards, "missing Public Smithers Cloud Factory card grid")
  assert.equal(factoryCards.cards.length, 4)
})
