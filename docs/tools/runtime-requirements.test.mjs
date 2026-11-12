import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

// The Node versions VibeLang supports have one source: the compiler package's
// engines field. Every package and the starter declare the same range, and every
// page that states a Node requirement spells that range.
const root = fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(join(root, path), "utf8")
const range = JSON.parse(read("packages/compiler/package.json")).engines.node
const [, floor22, floor24] = /^\^(22\.\d+\.\d+) \|\| >=(24\.\d+\.\d+)$/.exec(range) ?? []

const walk = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : /\.mdx?$/.test(entry.name) ? [join(dir, entry.name)] : [])
const packageDirs = readdirSync(join(root, "packages"), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => "packages/" + e.name)
const pages = [
  "README.md", "CONTRIBUTING.md", "site/src/index.mdx",
  ...walk("docs/user/src").filter(page => !page.endsWith("release-notes.md")),
  ...packageDirs.map(dir => dir + "/README.md").filter(page => existsSync(join(root, page))),
]

test("the compiler's engines field has the supported Node range", () => {
  assert.ok(floor22 && floor24, "unexpected engines.node " + range)
})

test("every package and the starter declare the compiler's Node range", () => {
  for (const manifest of [...packageDirs.map(dir => dir + "/package.json"), "templates/app/package.json"]) {
    if (!existsSync(join(root, manifest))) continue
    const node = JSON.parse(read(manifest)).engines?.node
    if (node !== undefined) assert.equal(node, range, manifest)
  }
})

test("every page that states a Node requirement spells the engines range", () => {
  const code = version => "`?" + version.replaceAll(".", "\\.") + "`?"
  const canonical = new RegExp(`^Node ${code(floor22)} \\(${code(floor22.split(".")[0] + ".x")}\\) or Node ${code(floor24)} or later$`)
  const found = []
  for (const page of pages) {
    for (const [statement] of read(page).matchAll(/Node `?\d+\.\d+\.\d+`?(?:(?!\. |\n)[^`]|`[^`\n]*`)*? or later/g)) {
      if (!canonical.test(statement)) found.push(`${page}: "${statement}"`)
    }
  }
  assert.deepEqual(found, [], `state the Node range as Node ${floor22} (${floor22.split(".")[0]}.x) or Node ${floor24} or later`)
})

test("a page that gives Bun's general minimum also gives the runtime loader's", () => {
  const found = pages.filter(page => /Bun(?: is optional, at| `?1\.4`? or later|, use Bun `?1\.4`? or later)|expect `1\.4\.0` or later/.test(read(page)) && !/1\.4\.2/.test(read(page)))
  assert.deepEqual(found, [], "these pages say Bun 1.4 is enough but not that running sources with Bun needs 1.4.2")
})
