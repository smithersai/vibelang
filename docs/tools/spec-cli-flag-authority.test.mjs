import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { chapter, read, repo } from "./spec-witness.mjs"

// Loop round 3, OPUS-9: chapter 000 defines the language as the accepted VIPs
// and their public amendments, so every VibeLang-owned flag chapter 7 prints
// needs a VIP that names it. TypeScript's own flags are the compiler's.
const vips = readdirSync(join(repo, "docs/design/vips"))
  .filter(f => /^\d{4}-.*\.md$/.test(f))
  .map(f => read(`docs/design/vips/${f}`))
  .filter(text => !/^\*\*Status:\*\* denied/mi.test(text))
  .join("\n")

// --project is TypeScript's; --write belongs to the repository script docs/tools/lint-codes.mjs.
const typescript = new Set(["--project", "--write"])

test("every VibeLang flag chapter 7 prints has an accepted VIP", () => {
  const tooling = chapter("007-tooling")
  const flags = new Set([...tooling.matchAll(/`[^`\n]*?(--[a-zA-Z][a-zA-Z-]*)[^`\n]*`/g)].map(m => m[1]))
  assert.ok(flags.has("--fix-migration-only") && flags.has("--fix-vip-only"))
  const missing = [...flags].filter(flag => !typescript.has(flag) && !vips.includes(flag))
  assert.deepEqual(missing, [])
})

test("VIP-34 states the fix-scope rule and chapter 7 links it", () => {
  const vip = read("docs/design/vips/0034-compiler-and-tooling.md")
  assert.ok(vip.includes("Either flag requires `--fix` somewhere in the argument list, before or after it; alone, each is an unknown compiler option (`TS5023`)"))
  assert.ok(chapter("007-tooling").includes("Two flags scope that invocation ([VIP-34, amended]"))
})
