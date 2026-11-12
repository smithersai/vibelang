import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// VibeLang ships no automatic fixes of its own before 1.0 (Developer tools,
// "TypeScript-style Effect code"; specification chapter 7, compiler and
// tooling requirements). A guide that tells a reader to apply a VibeLang
// editor action sends them to something that does not exist: it writes the
// edit instead.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const guides = resolve(root, "docs/user/src")
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : []
})
const ACTION = /\beditor action\b|\b(?:Apply|Select) "[^"]+"/i

test("user guides write the edit instead of naming a VibeLang editor action", () => {
  const hits = walk(guides)
    .filter(path => !path.endsWith("release-notes.md"))
    .flatMap(path => readFileSync(path, "utf8").split("\n").flatMap((line, i) => ACTION.test(line) ? [`${relative(guides, path)}:${i + 1}: ${line.match(ACTION)[0]}`] : []))
  assert.deepEqual(hits, [])
})
