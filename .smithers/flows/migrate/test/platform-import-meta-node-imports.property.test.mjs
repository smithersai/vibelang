import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import * as NodePath from "node:path"
import * as NodeURL from "node:url"
import { splitImportMeta } from "../lib/import-meta-platform.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-import-meta-companion-node-imports.json", import.meta.url)))
test("import metadata companions quote the preservation rule", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.quote))
})
function companion({ filename = false, collision = false } = {}) {
  const source = (collision ? "const $NodeURL = 1;\n" : "") +
    "export const directory = () => import.meta.dirname;\n" +
    (filename ? "export const filename = () => import.meta.filename;\n" : "")
  const split = splitImportMeta(source, "entry.ts", "entry.platform.ts", ts)
  assert.ok(split && !split.refused, JSON.stringify(split))
  return split.platform
}
function exportsOf(platform, windows) {
  const code = ts.transpileModule(platform, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const output = {}
  const url = { ...NodeURL, fileURLToPath: value => NodeURL.fileURLToPath(value, { windows }) }
  new Function("require", "exports", code)(name => name === "node:url" ? url : name === "node:path" ? windows ? NodePath.win32 : NodePath.posix : require(name), output)
  return output
}
function assertImports(platform) {
  const source = ts.createSourceFile("entry.platform.ts", platform, ts.ScriptTarget.Latest, true)
  const imports = source.statements.filter(ts.isImportDeclaration)
  assert.ok(imports.length > 0)
  for (const node of imports) {
    assert.equal(node.moduleSpecifier.text, "node:url", "no newly forbidden node:path import")
    assert.ok(ts.isNamespaceImport(node.importClause.namedBindings), "repository node imports use namespace bindings")
  }
}
test("T3 Code metadata companions introduce only namespace URL imports", () => {
  for (const filename of [false, true]) for (const collision of [false, true])
    assertImports(companion({ filename, collision }))
})
test("dirname keeps POSIX, drive and UNC roots and decoded directory names", () => {
  for (const windows of [false, true]) {
    const output = exportsOf(companion({ filename: true }), windows)
    const paths = windows ? ["C:\\entry.js", "C:\\a b\\mód.js", "\\\\server\\share\\entry.js", "\\\\server\\share\\dir\\entry.js"]
      : ["/entry.js", "//entry.js", "///entry.js", "/a b/mód.js", "/a%#?/entry.js", "/back\\slash/entry.js"]
    for (const path of paths) {
      const url = NodeURL.pathToFileURL(path, { windows }).href
      const decoded = NodeURL.fileURLToPath(url, { windows })
      assert.equal(output.$importMetaDirname(url), (windows ? NodePath.win32 : NodePath.posix).dirname(decoded), url)
      assert.equal(output.$importMetaFilename(url), decoded, url)
    }
  }
})
test("non-file metadata stays undefined and invalid encoded filenames still throw", () => {
  const output = exportsOf(companion(), false)
  for (const url of ["data:text/javascript,0", "https://example.test/entry.js", "node:fs"])
    assert.equal(output.$importMetaDirname(url), undefined, url)
  for (const url of ["file:///folder/bad%2Fname.js", "file:///folder/bad%00name.js", "file:///folder/%XX.js"]) {
    let failed = false
    try { NodeURL.fileURLToPath(url) } catch (error) {
      failed = true
      assert.throws(() => output.$importMetaDirname(url), actual => actual.name === error.name && actual.code === error.code)
    }
    if (!failed) assert.equal(output.$importMetaDirname(url), NodePath.posix.dirname(NodeURL.fileURLToPath(url)))
  }
})
test("property: namespace-only companions preserve host directory metadata", async () => {
  await checkProperty(fc, {
    name: corpus.key, rule: corpus.quote,
    command: "node --test .smithers/flows/migrate/test/platform-import-meta-node-imports.property.test.mjs",
    numRuns: 100,
    arbitrary: fc.record({ windows: fc.boolean(), filename: fc.boolean(), collision: fc.boolean(),
      parts: fc.array(fc.constantFrom("plain", "space name", "mód", "#hash", "%percent", "dot.name"), { minLength: 0, maxLength: 4 }),
      root: fc.constantFrom("drive", "unc"), leaf: fc.constantFrom("entry.js", "mód.js", "name%20.js") }),
    check: ({ windows, parts, root, leaf, filename, collision }) => {
      const platform = companion({ filename, collision })
      assertImports(platform)
      const prefix = windows ? root === "drive" ? "C:\\" : "\\\\host\\share\\" : "/"
      const path = prefix + [...parts, leaf].join(windows ? "\\" : "/")
      const url = NodeURL.pathToFileURL(path, { windows }).href
      const output = exportsOf(platform, windows)
      assert.equal(output.$importMetaDirname(url), (windows ? NodePath.win32 : NodePath.posix).dirname(NodeURL.fileURLToPath(url, { windows })))
      if (filename) assert.equal(output.$importMetaFilename(url), NodeURL.fileURLToPath(url, { windows }))
    }
  })
})
