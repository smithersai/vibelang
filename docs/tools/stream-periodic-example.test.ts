import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { extract } from "./check-snippets"

test("the periodic stream example is runnable", () => {
  const page = readFileSync(new URL("../user/src/stream/054-creating.md", import.meta.url), "utf8")
  const examples = extract(page).filter(block => block.source.includes("Stream.tick("))
  expect(examples).toHaveLength(1)
  const [example] = examples
  expect(example.fragment).toBe(false)
  expect(example.pending).toBeUndefined()
  expect(example.run).toBeDefined()
  expect(example.output).toBe("4 true")
})
