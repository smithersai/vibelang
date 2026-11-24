import assert from "node:assert/strict"
import { globSync, readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

// A target's cache key is the digest of its declared inputs. The vite and
// unplugin tests quote specification and user documents; a document they read
// but the target omits lets an edit that removes the quoted rule replay a green
// result. Every document a plugin test reads must be a pluginTest input.

const repo = fileURLToPath(new URL("../", import.meta.url))
const read = path => readFileSync(repo + path, "utf8")

function pluginTestInputs(source) {
  const start = source.indexOf("const pluginTest = ")
  const end = source.indexOf("\nconst ", start + 1)
  assert.ok(start >= 0 && end > start, "packages/PACKAGE.ts has no pluginTest")
  const block = source.slice(start, end)
  return new Set([...block.matchAll(/S\.file\(\s*"([^"$`]+)"\s*\)/g)]
    .map(([, path]) => path.startsWith("//") ? path.slice(2) : "packages/" + path))
}

// SpecPath (scripts/testing/spec-path.mjs) looks in docs/design/src, then
// docs/design/history/src; either declared location satisfies the read.
function documentsRead(source) {
  const reads = []
  for (const [, chapter] of source.matchAll(/SpecPath\(\s*"([^"]+)"\s*\)/g)) {
    reads.push(chapter.startsWith("../")
      ? ["docs/design/" + chapter.slice(3)]
      : ["docs/design/src/" + chapter, "docs/design/history/src/" + chapter])
  }
  for (const line of source.split("\n")) {
    if (!/readFile|readFileSync/.test(line)) continue
    for (const [path] of line.matchAll(/docs\/[\w./-]+\.md/g)) reads.push([path])
  }
  return reads
}

function missingInputs(declared, files) {
  const missing = []
  for (const [file, source] of files) {
    for (const choices of documentsRead(source)) {
      if (!choices.some(path => declared.has(path))) missing.push(file + " reads " + choices[0])
    }
  }
  return [...new Set(missing)].sort()
}

test("pluginTest declares every document the vite and unplugin tests read", () => {
  const declared = pluginTestInputs(read("packages/PACKAGE.ts"))
  const files = globSync("packages/{vite,unplugin}/test/*.test.mjs", { cwd: repo }).map(file => [file, read(file)])
  assert.ok(files.length > 0, "no plugin tests found")
  assert.deepEqual(missingInputs(declared, files), [])
})

test("the input scan reports an undeclared read and accepts either SpecPath location", () => {
  const declared = pluginTestInputs('const pluginTest = () => S.Shell.Test({ data: [S.file("//docs/design/history/src/9.md"), S.file("vite/package.json")] })\nconst next = 1')
  assert.ok(declared.has("packages/vite/package.json"))
  assert.deepEqual(missingInputs(declared, [
    ["a.test.mjs", 'readFileSync(SpecPath("9.md"))\nreadFileSync(SpecPath("../vips/1.md"))'],
    ["b.test.mjs", 'await readFile(new URL("../../../docs/user/src/setup/vite.md", import.meta.url))\nconst label = "docs/user/x.md"'],
  ]), ["a.test.mjs reads docs/design/vips/1.md", "b.test.mjs reads docs/user/src/setup/vite.md"])
})
