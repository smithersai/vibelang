import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../packages/runtime/", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")

// The compiler has no --fix option (TS5023), so the package page and the
// sources it ships must not tell users to run one.
const shipped = () => {
  const files = ["README.md", "package.json"]
  const walk = dir => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const path = dir + entry.name
      if (entry.isDirectory()) walk(path + "/")
      else if (/\.ts$/.test(entry.name)) files.push(path)
    }
  }
  walk("src/")
  return files
}

test("the runtime package never tells users to run vibelang --fix", () => {
  for (const path of shipped()) assert.doesNotMatch(read(path), /vibelang --fix/, path)
})

test("the runtime package describes the helpers compiled code imports", () => {
  const { description } = JSON.parse(read("package.json"))
  assert.doesNotMatch(description, /continuation kernel/i)
  assert.match(description, /compiled/)
  const intro = read("README.md").split("\n## ")[0]
  assert.doesNotMatch(intro, /runtime: the one-shot continuation kernel/)
  assert.match(intro, /compiler imports/)
  assert.match(intro, /EK3501/)
})
