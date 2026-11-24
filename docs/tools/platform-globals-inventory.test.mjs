import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { allowlist, artifactPath, generate, reachesHost, root, serialize } from "./platform-globals.mjs"
import { chapter, read } from "./spec-witness.mjs"

const inventory = () => JSON.parse(readFileSync(join(root, artifactPath), "utf8"))
const pinned = existsSync(join(root, "docs/tools/node_modules/@types/node"))

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#c6e052446ac444ba
// VIP-33: generated platform inventory.
test("the inventory is current for the pinned libs and @types/node", { skip: !pinned, timeout: 120_000 }, () => {
  assert.equal(readFileSync(join(root, artifactPath), "utf8"), serialize(generate()), "run node docs/tools/platform-globals.mjs --write")
})

test("importing the generator ignores a caller's write flag", () => {
  const artifact = join(root, artifactPath)
  const before = statSync(artifact).mtimeMs
  const importCommand = `process.argv.push("--write"); await import(${JSON.stringify(new URL("./platform-globals.mjs", import.meta.url).href)})`
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", importCommand], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(statSync(artifact).mtimeMs, before)
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

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#42f414bbb61d5184
// VIP-33: complete platform member classification.
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

// VIP-33 pinned platform inventory classifies every member of the closed allowlist; rule: docs/design/vips/0033-platform-stdlib.md#c6e052446ac444ba

// VIP-33 pinned platform inventory classifies every member of the closed allowlist; rule: docs/design/vips/0033-platform-stdlib.md#42f414bbb61d5184

