import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { command, defaultCompiler, linkModules } from "./check-snippets"
import { exampleCases } from "../../.smithers/flows/convert/build-prompt.mjs"

const exports = [
  ["02-stock-service", "stocked"],
  ["04-delivery-policy", "heartbeat"],
  ["05-parallel-metrics", "metrics"],
  ["08-background-race", "closest"],
  ["09-resource-cleanup", "inspect"]
]
async function verify(pairName: string, binding: string, replacement = binding) {
  const pair = exampleCases().find((pair: { name: string }) => pair.name === pairName)!
  const temp = mkdtempSync(join(tmpdir(), "docs-effect-export-"))
  try {
    linkModules(temp)
    writeFileSync(join(temp, "package.json"), '{"name":"docs-effect-export","type":"module"}')
    for (const [file, source] of [["input.ts", pair.input], ["expected.vibe", pair.expected]]) {
      writeFileSync(join(temp, file), source.replace(new RegExp("\\b" + binding + "\\b", "g"), replacement))
    }
    writeFileSync(join(temp, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, target: "es2022", module: "nodenext", types: [], skipLibCheck: true, outDir: "out", declaration: true },
      files: ["input.ts", "expected.vibe"]
    }))
    expect(await command([defaultCompiler(), "--singleThreaded", "-p", "tsconfig.json"], temp, 30000)).toMatchObject({ exitCode: 0 })
    for (const file of ["out/input.d.ts", "out/expected.d.ts"]) {
      expect(readFileSync(join(temp, file), "utf8")).toMatch(new RegExp("export declare const " + replacement + ": (?:[\\w$]+\\.)?Effect<"))
    }
    writeFileSync(join(temp, "oracle.mjs"), [
      'import assert from "node:assert/strict"; import { Effect } from "effect";',
      'import * as original from "./out/input.js"; import * as migrated from "./out/expected.js";',
      'assert.equal(Effect.isEffect(original.' + replacement + '), true);',
      'assert.equal(Effect.isEffect(migrated.' + replacement + '), true);',
      'assert.deepEqual(await Effect.runPromise(migrated.' + replacement + '), await Effect.runPromise(original.' + replacement + '));'
    ].join("\n"))
    expect(await command(["node", "oracle.mjs"], temp, 30000)).toMatchObject({ exitCode: 0 })
  } finally { rmSync(temp, { recursive: true, force: true }) }
}
test("RD-005: every Effect-valued example export keeps its declaration and runnable value", async () => {
  for (const [pair, binding] of exports) await verify(pair, binding)
}, 60000)

test("RD-005 property: renaming exported programs preserves lazy Effect values", async () => {
  const fc = createRequire(new URL("../../packages/runtime/package.json", import.meta.url))("fast-check")
  await fc.assert(fc.asyncProperty(fc.constantFrom(...exports), fc.stringMatching(/^[a-z]{1,8}$/), async ([pair, binding]: string[], suffix: string) => {
    await verify(pair, binding, binding + suffix)
  }), { numRuns: 8, seed: 4005 })
}, 60000)

