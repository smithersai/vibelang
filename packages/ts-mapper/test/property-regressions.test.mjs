import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const regDir = new URL("./property-regressions/", import.meta.url)

test("property-regressions fixtures are valid JSON with no private host paths", () => {
  const files = readdirSync(regDir).filter((f) => f.endsWith(".json")).sort()
  assert.ok(files.length >= 2, "expected at least 2 property regression JSON fixtures")
  for (const file of files) {
    const raw = readFileSync(new URL(file, regDir), "utf8")
    const parsed = JSON.parse(raw)
    assert.ok(parsed && typeof parsed === "object", `${file} must parse as JSON object`)
    assert.ok(!raw.includes("/Users/"), `${file} must not leak local macOS user paths`)
    assert.ok(!raw.includes("/home/"), `${file} must not leak local Linux home paths`)
  }
})
