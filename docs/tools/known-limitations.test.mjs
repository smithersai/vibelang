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

// Keep the support boundary and observed release behavior visible in both copies.
test("Known limitations has one experimental opt-in section that names each checked spelling", () => {
  for (const rel of ["../user/src/setup/known-limitations.md", "../../site/src/pages/setup/known-limitations.mdx"]) {
    const text = readFileSync(new URL(rel, import.meta.url), "utf8")
    assert.equal(text.match(/^## The experimental opt-in$/gm)?.length, 1, rel + ": one experimental opt-in section")
    assert.ok(!text.includes("the direct uses of the eight experimental modules"), rel + ": no direct-uses-only claim")
    assert.ok(!text.includes("It does not yet catch an alias"), rel + ": no stale alias limitation")
    assert.ok(!text.includes("refuses every use in a `.vibe` or `.vibex` file that resolves"), rel + ": no claim that every resolved use is refused")
    assert.ok(!text.includes("a re-export from another `.ts` or `.vibe` file"), rel + ": no blanket bridge-refusal claim")
    assert.ok(text.includes("It is a support boundary, not a security boundary:"), rel + ": states the support boundary")
    assert.ok(text.includes("These are the routes found so far, and the list is not complete;"), rel + ": does not imply an exhaustive list")
    assert.ok(text.includes("unsupported the moment it reaches any of the eight modules by any route"), rel + ": support depends on use, not spelling")
    assert.ok(!text.includes("including member accesses through an alias,"), rel + ": no unqualified alias-refusal claim")
    assert.ok(text.includes("an alias whose type is the namespace itself"), rel + ": qualifies namespace aliases")
    assert.ok(text.includes("outside `module` bodies"), rel + ": qualifies literal subpath refusals")
    assert.ok(text.includes("enumerating the whole namespace stays allowed"), rel + ": preserves core-only namespace enumeration")
    assert.ok(text.includes("type-only"), rel + ": distinguishes type references from runtime operations")
    assert.ok(text.includes("`.ts` and `.js` bridge files"), rel + ": names both bridge extensions")
    assert.ok(text.includes("experimental operations run"), rel + ": distinguishes value bridges from erased types")
    // Clearing conditions: boundary, bounded refusals, route and type coverage,
    // runtime evidence, eight-module scope, and bounded future enforcement.
    for (const phrase of [
      "cannot stop a program that sets out to reach an open-proposal module",
      "### What `EK3013` refuses",
      "### Routes the check does not follow in 0.0.13",
      "These nine type-only spellings compile without the opt-in; they are erased and no experimental operation runs",
      "obtain a Durable engine without opting in",
      "`Readonly<typeof Experimental>`",
      "including type-only references",
      '`Experimental["Durable" as never]`',
      '`{ Durable: (typeof Experimental)["Durable"] }`',
      "Its body is inline TypeScript; the opt-in check does not run on it",
      "The check cannot see a use whose target the compiler does not resolve",
      "It does not check the uses inside `.ts` files or a dependency's JavaScript",
      "A `.ts` or `.js` entry can import a gated subpath",
      "The next release closes the value routes that select a gated member",
    ]) assert.ok(text.includes(phrase), rel + ": clearing condition " + phrase)
    for (const name of ["Durable", "Human", "Eval", "Scorer", "Memory", "Fuzz", "FuzzSimulation", "Test"]) {
      assert.ok(text.includes("`" + name + "`"), rel + ": names gated module " + name)
    }
    assert.ok(!text.includes("The next release refuses them"), rel + ": no blanket enumeration promise")
    // Keep each observed spelling visible until its documented behavior changes.
    for (const spelling of [
      "`let D; ({ Durable: D } = Experimental)`",
      '`const { ["Durable"]: D } = Experimental`',
      '`Experimental[k]` where `k: "Durable" | "Fuzz"`',
      "`Object.entries(Experimental)`",
      '`import { $task } from "vibelang-runtime/internal"`',
      '`import { memory } from "./node_modules/vibelang-runtime/dist/experimental/Durable.js"`',
      "`export type D = (typeof Experimental)[\"Durable\"]`",
      "`export type X = typeof Experimental[\"Durable\"]`",
      "`type NS = typeof Experimental; export type D = NS[\"Durable\"]`",
      "`export type P = Pick<typeof Experimental, \"Durable\">`",
      "`export type K = keyof typeof Experimental`",
      "`export type M = { [K in keyof typeof Experimental]: (typeof Experimental)[K] }`",
      "`export type E = Extract<keyof typeof Experimental, \"Durable\">`",
      "`export type O = Omit<typeof Experimental, \"NetAddress\">`",
      "`export type C = typeof Experimental extends { Durable: infer D } ? D : never`",
      "`export type { Store as S } from \"vibelang-runtime/experimental/Durable\"`",
      "`export { memory } from \"vibelang-runtime/experimental/Durable\"`",
      "`import type { Store } from \"vibelang-runtime/experimental/Durable\"`",
      "`ReturnType<typeof Experimental.Durable.makeMemoryStore>`",
      "`import { memory } from \"./bridge.js\"`",
      "`import type { S } from \"./bridge.js\"`",
      "`const E = flag ? Experimental : { Durable: undefined }; return E.Durable`",
      '`module bridge { export { memory, Durable, TypeId } from "vibelang-runtime/experimental/Durable" }; import { memory, Durable, TypeId } from bridge`',
      '`const E: Pick<typeof Experimental, "Durable"> = Experimental; const D = E.Durable`',
      "`const E = Experimental`",
      "`import { Experimental as E } from \"vibelang-runtime\"`",
      "`import * as E from \"vibelang-runtime/experimental\"`",
    ]) assert.ok(text.includes(spelling), rel + ": names the checked spelling " + spelling)
  }
})
