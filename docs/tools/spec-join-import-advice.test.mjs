import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("join-renaming advice uses an admitted project value import", () => {
  const line = running().split("\n").find(line => line.includes("rename it at the import"))
  assert.ok(line)
  const from = line.match(/from "([^"]+)"/)?.[1]
  assert.ok(from?.startsWith("./"), "repair advice must not use a forbidden Node value import")
  assert.match(line, /join as [A-Za-z]+/)
})
