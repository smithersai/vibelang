import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8")
const packages = ["packages/compiler", "packages/runtime", "packages/create-vibelang", "templates/app"]
const pages = [
  "001-onboarding.md",
  "013-getting-started.md",
  "setup.md",
  "getting-started/004-installation.md"
]

for (const page of pages) {
  test(page + ": Node prerequisites agree with the installed packages", () => {
    const text = read("docs/user/src/" + page).replaceAll(String.fromCharCode(96), "")
    const prerequisite = /Node (\d+\.\d+\.\d+) \((\d+)\.x\) or Node (\d+\.\d+\.\d+) or later/.exec(text)
    assert.ok(prerequisite, "state both supported Node release lines, with their minimum patches")
    assert.equal(prerequisite[1].split(".")[0], prerequisite[2])
    const documented = "^" + prerequisite[1] + " || >=" + prerequisite[3]
    for (const path of packages) {
      assert.equal(documented, JSON.parse(read(path + "/package.json")).engines.node, path)
    }
  })
}
