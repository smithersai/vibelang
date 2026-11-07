import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const guide = (name) => readFileSync(new URL("../user/src/error-management/" + name + ".md", import.meta.url), "utf8")

test("the expected-errors guide states the static-member restriction once with its repair details", () => {
  const text = guide("014-expected-errors")
  const paragraphs = text.split(/\r?\n/).filter(p => p.startsWith("User-written `static` members are forbidden"))
  assert.equal(paragraphs.length, 1, "keep one complete static-member rule")
  assert.ok(paragraphs[0].includes("`EK1302` takes precedence"))
  assert.ok(paragraphs[0].includes("the migration imports `TaggedError` from `vibelang-runtime`"))
})
