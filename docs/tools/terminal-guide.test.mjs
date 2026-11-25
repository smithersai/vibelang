import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const page = new URL("../user/src/platform/110-terminal.md", import.meta.url)

test("the terminal guide assigns raw mode to key input", () => {
  const text = readFileSync(page, "utf8")
  assert.equal(/line reader[^.]*raw mode/.test(text), false, "readLine does not enable raw mode")
  assert.match(text, /`readInput`[^.]*raw mode/)
})
