import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import fc from "fast-check"
import * as prettier from "prettier"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
import { formatSource } from "../format.mjs"

const oxfmt = process.env.VIBELANG_OXFMT || join(dirname(createRequire(import.meta.url).resolve("oxfmt/package.json")), "bin/oxfmt")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-jsdoc-blank-lines.json", import.meta.url), "utf8"))
const comments = text => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
  const found = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token === ts.SyntaxKind.MultiLineCommentTrivia || token === ts.SyntaxKind.SingleLineCommentTrivia) {
      found.push(scanner.getTokenText().split(/\r?\n/).map(line => line.trimStart()))
    }
  }
  return found
}
for (const { name, source } of corpus) {
  test("JSDoc preserves Alchemy's " + name + " comment and agrees with the TypeScript twin", async () => {
    const formatted = formatSource(source, "docs.vibe")
    assert.deepEqual(comments(formatted), comments(source))
    assert.equal(formatSource(formatted, "docs.vibe"), formatted)
    const twin = await prettier.format(source, { parser: "typescript" })
    assert.deepEqual(comments(formatted), comments(twin))
    {
      const oracle = spawnSync(oxfmt, ["--stdin-filepath", "docs.ts"], { input: source, encoding: "utf8" })
      assert.equal(oracle.status, 0, oracle.stderr)
      assert.deepEqual(comments(formatted), comments(oracle.stdout))
    }
  })
}

// Chapter 7: "Comments and their code associations survive, including JSDoc,
// compiler/linter/tool directives and directive-prologue meaning."
test("property: comment non-whitespace content and blank-line structure survive formatting", () => {
  const contract = "Comments and their code associations survive, including JSDoc, compiler/linter/tool directives and directive-prologue meaning."
  assert.ok(readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8").includes(contract), "update the quoted formatter contract")
  fc.assert(fc.property(fc.array(fc.constantFrom("paragraph", "", "", "@param value The value.", "  code();", "~~~ts", "~~~", "{@link Value}", "vibelang_doc_0"), { minLength: 1, maxLength: 16 }),
    fc.integer({ min: 0, max: 5 }), fc.boolean(), fc.boolean(), (lines, indent, crlf, ordinary) => {
      const comment = (ordinary ? "/*\n" : "/**\n") + lines.map(line => " *" + (line ? " " + line : "")).join("\n") + "\n */"
      const source = ("function scope(){\n" + " ".repeat(indent) + comment.replaceAll("\n", "\n" + " ".repeat(indent)) + "\nconst value=1 // retained\n/* ordinary */ return value\n}\n").replaceAll("\n", crlf ? "\r\n" : "\n")
      const after = formatSource(source, "comments.vibe")
      assert.deepEqual(comments(after), comments(source))
      assert.equal(formatSource(after, "comments.vibe"), after)
    }), { numRuns: 64 })
})

test("comment-looking strings, template tails, regexps and JSX text retain their values", () => {
  for (const [file, source] of [
    ["literal.vibe", 'const text = "/** not a comment */"; const pattern = /[/**]/; const tail = `start ${1} /** still text */`\n'],
    ["literal.vibex", 'const view = <div>/** text */{1}/** tail */</div>\n'],
    ["module.vibe", "module docs {\n/**\n * paragraph\n *\n *\n * end\n *\n */\nexport const value=1\n}\n"],
  ]) {
    const after = formatSource(source, file)
    assert.equal(formatSource(after, file), after)
    if (file === "module.vibe") assert.deepEqual(comments(after), comments(source))
  }
})

test("ordinary block comments keep the leading blank line found by the property", () => {
  const { source } = JSON.parse(readFileSync(new URL("./property-regressions/format-block-comment-leading-blank.json", import.meta.url), "utf8"))
  const after = formatSource(source, "comments.vibe")
  assert.deepEqual(comments(after), comments(source))
  assert.equal(formatSource(after, "comments.vibe"), after)
})

test("block ignore directives remain visible to the TypeScript formatter", () => {
  const source = "/* dprint-ignore */\nconst   ignored =   1\nconst normal=2\n"
  const after = formatSource(source, "ignored.vibe")
  assert.ok(after.includes("const   ignored =   1"))
  assert.equal(formatSource(after, "ignored.vibe"), after)
})
