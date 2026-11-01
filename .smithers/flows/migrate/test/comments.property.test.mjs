import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { parseImports } from "../lib/imports.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const quote = "A specifier in a comment stays as written"

const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

// Smithers build/targets: ToolRun.ts stays .ts, and a doc comment's
// import("./x.ts") turned into ./x.vibe, which declaration emit copied.
test("smithers build/targets: a doc comment's import type keeps its specifier", () => {
  assert.ok(contract.includes(quote), "update the quoted comment contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-jsdoc-import-link.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-comments-"))
  try {
    for (const [path, text] of Object.entries(corpus.files)) put(root, path, text)
    const renames = renameBatch(root, corpus.batch)
    const scope = Object.keys(corpus.files).map((f) => (corpus.batch.includes(f) ? f.replace(/\.ts$/, ".vibe") : f))
    const edits = rewriteImports(root, scope, renames.map((r) => r.to))
    assert.deepEqual(edits.map((e) => `${e.file}: ${e.from} -> ${e.to}`), corpus.expected)
    for (const [path, line] of Object.entries(corpus.kept)) assert.ok(readFileSync(join(root, path), "utf8").includes(line), path)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Code around comments: what comes before an import must not hide it, and a
// comment must not count as one. The strings hold what opens a comment.
const comment = fc.constantFrom(
  (s) => `// see import("${s}")\n`,
  (s) => `/* import("${s}") */\n`,
  (s) => `/** {@link import("${s}").B} */\n`,
  (s) => `/**\n * import { B } from "${s}"\n */\n`,
  (s) => `// import "${s}"\n`
)
const code = fc.constantFrom(
  "const url = \"https://example.com\"\n",
  "const glob = 'src/**/*.ts'\n",
  "const text = `a // ${1 + 1} /* b`\n",
  "const nested = `${`x${{ a: 1 }.a}`} //`\n",
  "const a = { b: { c: 1 } }\n",
  "const division = 4 / 2 / 1\n"
)
const real = fc.constantFrom(
  (s) => `import { B } from "${s}"\n`,
  (s) => `export { B } from "${s}"\n`,
  (s) => `const lazy = import("${s}")\n`,
  (s) => `import "${s}"\n`
)

test("parseImports finds every real specifier and none in a comment", () => {
  const part = fc.oneof(
    fc.record({ kind: fc.constant("comment"), write: comment }),
    fc.record({ kind: fc.constant("code"), write: code }),
    fc.record({ kind: fc.constant("real"), write: real })
  )
  fc.assert(fc.property(fc.array(part, { maxLength: 8 }), (parts) => {
    let text = ""
    let expected = 0
    parts.forEach((p, i) => {
      if (p.kind === "code") text += p.write
      else text += p.write(p.kind === "real" ? `./real${expected++}.ts` : `./comment${i}.ts`)
    })
    assert.deepEqual(parseImports(text).map((f) => f.specifier), Array.from({ length: expected }, (_, n) => `./real${n}.ts`), text)
  }))
})

test("an unterminated block comment, as a regular expression can look, hides nothing", () => {
  assert.deepEqual(parseImports("const glob = /a\\/*/\nimport { B } from \"./b.ts\"\n").map((f) => f.specifier), ["./b.ts"])
})
