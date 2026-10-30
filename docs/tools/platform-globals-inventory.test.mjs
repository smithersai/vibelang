import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { allowlist, artifactPath, generate, reachesHost, root, serialize } from "./platform-globals.mjs"
import { chapter, read } from "./spec-witness.mjs"

const inventory = () => JSON.parse(readFileSync(join(root, artifactPath), "utf8"))
const pinned = existsSync(join(root, "docs/tools/node_modules/@types/node"))

test("the inventory is current for the pinned libs and @types/node", { skip: !pinned, timeout: 120_000 }, () => {
  assert.equal(readFileSync(join(root, artifactPath), "utf8"), serialize(generate()), "run node docs/tools/platform-globals.mjs --write")
})

test("the banned set follows the rule", () => {
  const { banned } = inventory()
  for (const name of ["fetch", "process", "Buffer", "console", "setTimeout", "history", "requestAnimationFrame", "FileReader", "WebAssembly", "name", "open"]) {
    assert.ok(banned.includes(name), `${name} is a host global`)
  }
  for (const name of [...allowlist, "Date", "Math", "JSON", "Intl", "Promise", "Map"]) {
    assert.ok(!banned.includes(name), `${name} is not banned`)
  }
})

test("every member of an allowlisted global is classified, and the banned ones have reasons", () => {
  const { members } = inventory()
  const banned = members.filter(m => m.status === "banned").map(m => m.member)
  assert.deepEqual(banned.sort(), Object.keys(reachesHost).sort())
  assert.ok(members.every(m => m.status === "banned" ? m.reason : m.status === "allowed"))
  assert.ok(members.some(m => m.member === "URL.canParse" && m.status === "allowed"))
})

test("chapter 5 and the inventory agree", () => {
  const services = chapter("005-services")
  const { allowlist: allowed, banned, members } = inventory()
  const sentence = services.match(/web data utilities with no I\/O \(([^)]*)\)/)
  assert.ok(sentence, "the allowlist sentence moved")
  const named = [...sentence[1].matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(name => name !== "Intl")
  assert.deepEqual(named.sort(), [...allowed].sort())
  for (const member of members.filter(m => m.status === "banned").map(m => m.member)) {
    assert.ok(services.includes("`" + member + "`"), `chapter 5 names ${member}`)
  }
  const list = services.slice(services.indexOf("which keep their quick fixes:"), services.indexOf("It also includes every other host global"))
  for (const [, name] of list.matchAll(/`([^`]+)`/g)) assert.ok(banned.includes(name), `${name} is in the bullets, not the inventory`)
  assert.match(read("docs/design/vips/0033-platform-stdlib.md"), /Amended 2026-10-30: one rule for platform members/)
})
