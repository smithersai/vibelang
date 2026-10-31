import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import compile from "../knip.mjs"

// vibelang/knip's stubs carry the JSDoc TypeScript attaches to each export,
// whose tags Knip reads (`/** @public */` keeps an export no module imports).
// The oracle is TypeScript itself: for a module written in the syntax the two
// languages share, every exported name's JSDoc in the stub module equals its
// JSDoc in the original. drive-t3code found the gap on t3code's shared Net.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const missing = [native, join(modules, "typescript")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`
if (!process.env.VIBELANG_BINARY && !skip) process.env.VIBELANG_BINARY = native
const quote = "linters, Knip, bundlers and test runners each read `.vibe`"

const trivia = ["/** @public */", "/** A doc. */", "/**\n * Two lines.\n * @internal\n */", "/* @public */", "// @public", "", "/***/"]
const after = ["", " /** @public */", " // @public", " /* note */"]
const kinds = ["const", "pair", "function", "class", "interface", "type", "local"]

function statement(kind, i) {
  return {
    const: `export const n${i} = 1`,
    pair: `export const n${i} = 1, m${i} = 2`,
    function: `export function n${i}() {}`,
    class: `export class N${i} {}`,
    interface: `export interface N${i} {}`,
    type: `export type N${i} = number`,
    local: `const n${i} = 1`,
  }[kind]
}

function source(input) {
  return input.map((s, i) => [...s.before.map((t) => t + "\n"), statement(s.kind, i), s.after, "\n"].join("")).join("")
}

// Each exported name and the text of the JSDoc comments TypeScript gives it.
function exportedDocs(ts, text) {
  const file = ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const docs = {}
  const exported = (node) => ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export
  const read = (node) => ts.getJSDocCommentsAndTags(node).map((doc) => doc.getText(file))
  for (const node of file.statements) {
    if (ts.isVariableStatement(node) && exported(node.declarationList.declarations[0])) {
      for (const d of node.declarationList.declarations) docs[d.name.getText(file)] = read(d)
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && exported(node)) {
      docs[node.name.getText(file)] = read(node)
    }
  }
  return docs
}

test("the JSDoc oracle quotes the current specification", () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(quote))
})

test("each export's stub has the JSDoc TypeScript attaches to the export", { skip }, async () => {
  const ts = createRequire(join(modules, "typescript/package.json"))("typescript")
  let diagnostics = ""
  await checkProperty(fc, {
    name: "knip-export-jsdoc",
    rule: "docs/design/src/007-tooling.md: " + quote + "; Knip reads an export's JSDoc tags",
    command: "node --test knip.property.test.mjs",
    regressions: new URL("./property-regressions/", import.meta.url),
    numRuns: 80,
    arbitrary: fc.array(fc.record({
      kind: fc.constantFrom(...kinds),
      before: fc.array(fc.constantFrom(...trivia), { maxLength: 3 }),
      after: fc.constantFrom(...after),
    }), { minLength: 1, maxLength: 5 }),
    artifacts: (input) => ({ "module.vibe": source(input) }),
    diagnostics: () => diagnostics,
    check: (input) => {
      const text = source(input)
      const stub = compile(text, "src/module.vibe")
      diagnostics = stub
      assert.deepEqual(exportedDocs(ts, stub), exportedDocs(ts, text))
    },
  })
})
