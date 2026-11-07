import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("plain-handler parameter and body calls identify the synchronous no-throw diagnostic", () => {
  const guide = readFileSync(new URL("../user/src/error-management/016-fallback.md", import.meta.url), "utf8")
  const rule = guide.split("\n").find(line => line.startsWith("A plain handler's default parameters"))
  assert.ok(rule.includes("(`EK0401`)"), "plain-handler throwing calls report EK0401")
  assert.ok(rule.includes("Use an effect handler with nonthrowing parameters"))
})
