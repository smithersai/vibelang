import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
const root = process.env.VIBELANG_DOCS_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(join(root, path), "utf8")
test("current install surfaces describe the six native release packages", () => {
  const pkg = JSON.parse(read("packages/compiler/package.json"))
  const names = Object.keys(pkg.optionalDependencies)
  assert.equal(names.length, 6)
  for (const path of ["docs/user/src/getting-started/004-installation.md", "packages/compiler/README.md"]) {
    for (const name of names) assert.ok(read(path).includes(name), path + " omits " + name)
  }
  for (const path of ["docs/user/src/getting-started/004-installation.md", "docs/user/src/setup.md",
    "docs/user/src/setup/known-limitations.md", "packages/compiler/README.md",
    ".smithers/instructions/app.md", "site/src/pages/index.mdx"]) {
    const text = read(path)
    assert.match(text, /Windows/, path)
    assert.doesNotMatch(text, /Windows binaries are not (?:available|published)|Windows via WSL|publishes four native|one of four/, path)
  }
})

test("the Windows maintainer guide lists the packed Windows tarballs", () => {
  const compiler = JSON.parse(read("packages/compiler/package.json"))
  const expected = Object.keys(compiler.optionalDependencies)
    .filter(name => name.includes("win32"))
    .map(name => `${name.slice(1).replace("/", "-")}-\${VERSION}.tgz`)
    .sort()
  const guide = read("docs/maintainers/windows-release.md")
  assert.deepEqual([...new Set(guide.match(/[\w-]+-win32-[\w-]+-\$\{VERSION\}\.tgz/g))].sort(), expected)
})
