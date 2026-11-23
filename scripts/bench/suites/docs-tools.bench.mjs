#!/usr/bin/env node
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const { generateThrowsInventory, serializeInventory } = await import(path.join(root, "docs/tools/throws-inventory.mjs"))

const throwsJson = JSON.parse(readFileSync(path.join(root, "docs/design/inventory/throws.json"), "utf8"))

await runSuite({
  suite: "docs-tools",
  category: "tooling",
  description: "Documentation tooling generators: throws-inventory TypeScript surface scan and serialization.",
  cases: [
    {
      name: "throws-inventory.serializeInventory",
      fn: () => serializeInventory(throwsJson),
      verify: (text) => assert.ok(text.length > 1000)
    },
    {
      name: "throws-inventory.generateThrowsInventory",
      samples: 2,
      warmup: 0,
      batch: 1,
      fn: () => generateThrowsInventory(),
      verify: (inv) => assert.ok(inv && Object.keys(inv).length > 0)
    }
  ]
})
