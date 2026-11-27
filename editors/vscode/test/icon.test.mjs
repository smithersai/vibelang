import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { assertLanguageIcons } from "./icon-assertions.mjs"

const root = new URL("../", import.meta.url)

test("both language icons use the text-free VibeLang site mark", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
  assertLanguageIcons(manifest, (file) => readFileSync(new URL(file, root), "utf8"))
})

test("extension Marketplace icon is a crisp PNG at least 128x128", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
  assert.equal(typeof manifest.icon, "string", "package.json declares a top-level icon")
  assert.match(manifest.icon, /\.png$/i, "VS Code Marketplace requires a PNG extension icon, not SVG")
  const bytes = readFileSync(new URL(manifest.icon, root))
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "valid PNG signature")
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", "IHDR chunk follows signature")
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  assert.ok(width >= 128 && height >= 128, `expected icon >= 128x128, got ${width}x${height}`)
  assert.equal(width, height, `expected square icon, got ${width}x${height}`)
})
