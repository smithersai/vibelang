import { expect, test } from "bun:test"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { command, defaultCompiler, linkModules } from "./check-snippets"
import { exampleCases, cheatSheet } from "../../.smithers/flows/convert/build-prompt.mjs"

test("RD-004: conversion pairs and cheat sheet preserve explicit input keys", () => {
  const sheet = cheatSheet()
  expect(sheet).toContain('static readonly key = "app/Users"')
  for (const pair of exampleCases()) {
    for (const match of pair.input.matchAll(/class (\w+) extends Context\.Service[\s\S]*?\}\>\(\)\("([^"]+)"\)/g)) {
      expect(pair.expected).toContain('static readonly key = "' + match[2] + '"')
    }
  }
})

test("RD-004 property: providers retain identity for arbitrary migrated service keys", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  const corpus = JSON.parse(readFileSync(new URL("./fixtures/smithers-service-key-identity.json", import.meta.url), "utf8"))
  const pairs = exampleCases().filter((pair: { name: string }) => /02-stock|03-layer/.test(pair.name))
  await fc.assert(fc.asyncProperty(fc.constantFrom(...pairs, corpus), fc.string({ minLength: 1, maxLength: 30 }), async (pair: { name: string; input: string; expected: string; service?: string; key?: string }, key: string) => {
    const temp = mkdtempSync(join(tmpdir(), "docs-key-property-"))
    try {
      linkModules(temp)
      const stock = pair.name.includes("02-stock")
      const service = pair.service ?? (stock ? "Stock" : "Banner")
      const originalKey = JSON.stringify(pair.key ?? (stock ? "warehouse/Stock" : "news/Banner"))
      writeFileSync(join(temp, "package.json"), '{"type":"module","name":"docs-key-property"}')
      writeFileSync(join(temp, "input.ts"), pair.input.replace(originalKey, JSON.stringify(key)) + "\nexport { " + service + " }\n")
      writeFileSync(join(temp, "expected.vibe"), pair.expected.replace(originalKey, JSON.stringify(key)) + "\nexport { " + service + " }\n")
      writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, module: "nodenext", target: "es2022", types: [], skipLibCheck: true, outDir: "out", declaration: true }, files: ["input.ts", "expected.vibe"]
      }))
      expect(await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)).toMatchObject({ exitCode: 0 })
      writeFileSync(join(temp, "oracle.mjs"), [
        'import assert from "node:assert/strict"; import { Effect } from "effect";',
        'import * as original from "./out/input.js"; import * as migrated from "./out/expected.js";',
        'assert.equal(migrated.' + service + '.key, original.' + service + '.key);',
        ...(stock ? ['assert.equal(await Effect.runPromise(Effect.provideService(migrated.available("TEA"), original.Stock, { count: (sku) => Effect.succeed(sku.length * 6) })), true)'] : [])
      ].join("\n"))
      expect(await command(["node", "oracle.mjs"], temp, 30000)).toMatchObject({ exitCode: 0 })
    } finally { rmSync(temp, { recursive: true, force: true }) }
  }), { numRuns: 10, seed: 4004, examples: [[corpus, corpus.key]] })
}, 60000)

