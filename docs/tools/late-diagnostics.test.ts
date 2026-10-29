import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const root = process.env.DOCS_REVIEW_ROOT || resolve(import.meta.dir, "../..")
test("late diagnostics have reference meanings and actionable repairs", () => {
  const page = readFileSync(resolve(root, "docs/user/src/getting-started/012-devtools.md"), "utf8")
  for (const [code, meaning, repair] of [
    ["EK1017", /expression/, /provide layer/],
    ["EK4838", /region/, /fork\.in\(scope\)/],
    ["EK9101", /editor-only/, /annotation/]
  ] as const) {
    const row = page.split("\n").find(line => line.startsWith("| " + code + " |")) || ""
    expect(row).toMatch(meaning)
    expect(row).toMatch(repair)
  }
})
