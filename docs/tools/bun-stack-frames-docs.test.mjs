import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Source maps' Limits section owns the rule for stack frames under
// `vibelang/bun`: mapped `.vibe` lines for a module Bun runs without
// transpiling, compiled lines otherwise. The CLI guide states the same
// condition and links it, rather than an unconditional "Bun ignores".
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, "docs/user/src", path), "utf8")

test("the CLI guide and Source maps agree on Bun stack frames", () => {
  const limits = read("setup/source-maps.md")
  assert.match(limits, /\*\*Bun's runtime:\*\* Bun reads a source map only from a module it runs without transpiling\./)
  const cli = read("setup/vibelang-cli.md")
  assert.doesNotMatch(cli, /Bun ignores a plugin's source maps, so a stack frame/)
  assert.match(cli, /emitted JavaScript is ASCII and needs nothing from Bun's transpiler; otherwise it names the `\.vibe` file with the line of its compiled JavaScript \(\[Source maps: Limits\]\(source-maps\.md#limits\)\)/)
})
