import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"
import { inspectWorkspaceBarrel } from "./workspace-barrel-fixture.mjs"

const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-58-bare-typescript-barrel-vibe.json", import.meta.url), "utf8"))
const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8")
const quote = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."

test("alchemy-58: bare TypeScript barrel, relative VibeLang and actual Bun/Rolldown stages", () => {
  assert.ok(chapter.includes(quote), "Chapter 7's existing-tools contract")
  inspectWorkspaceBarrel(corpus.input, true)
})

test("workspace barrels preserve native values across naming and nesting under Bun/Rolldown", () => {
  assert.ok(chapter.includes(quote), "Chapter 7's existing-tools contract")
  fc.assert(fc.property(fc.record({
    name: fc.constantFrom("binding-layer", "worker-names", "module-λ"),
    depth: fc.integer({ min: 1, max: 3 }),
    value: fc.integer({ min: -10, max: 30 }),
    text: fc.constantFrom("worker", "café", "雪")
  }), input => inspectWorkspaceBarrel(input)), { seed: 581101, numRuns: 8 })
})
