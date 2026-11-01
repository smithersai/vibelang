import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const spec = read("../design/src/001-functions.md")
const cli = read("../user/src/setup/vibelang-cli.md")
const paragraph = cli.split("\n\n").find(text => text.startsWith("An import a declaration file adds,"))

// RD-007: declaration output, 001-functions.md, Specifiers.
for (const rule of [
  "the file's first written import or export specifier",
  "a file with none gets double quotes",
]) {
  test(`the CLI declaration-import quote rule includes: ${rule}`, () => {
    assert.ok(spec.includes(rule), "the declaration-output specification is the oracle")
    assert.ok(paragraph?.includes(rule), "the CLI page must explain the same quote rule")
  })
}
