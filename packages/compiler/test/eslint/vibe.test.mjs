// vibelang/eslint on VibeLang's own forms: every cheat-sheet form parses into
// a tree whose tokens are the source and whose nodes keep every name the
// author wrote, the rules Smithers lints with find nothing in clean code and
// each seeded violation, fixes land on the .vibe text, and a syntax error is
// ESLint's parsing error. A module declaration's body (D283) lints as a
// TypeScript module of its own.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"
import importPlugin from "eslint-plugin-import"
import unicorn from "eslint-plugin-unicorn"
import { visitorKeys as typescriptKeys } from "@typescript-eslint/visitor-keys"
import vibelang, { parseForESLint, vibeVisitorKeys } from "../../eslint.mjs"
import { config } from "./config.mjs"
import { repo } from "./helpers.mjs"
import { allVisitorKeys, problems, walk } from "./tree.mjs"

const fixture = (name) => {
  const filename = new URL(`./fixtures/${name}`, import.meta.url).pathname
  return { filename, code: readFileSync(filename, "utf8") }
}
const lint = ({ code, filename }) => new Linter({ configType: "flat", cwd: "/" }).verify(code, config, { filename })
const keys = allVisitorKeys(typescriptKeys)

test("every cheat-sheet form parses into a tree of the source's own tokens and names", () => {
  const { code, filename } = fixture("forms.vibe")
  const { ast } = parseForESLint(code, { filePath: filename })
  assert.deepEqual(problems(code, ast, keys), [])
})

test("VibeLang's forms take their own node types, which keep every source child", () => {
  const { code, filename } = fixture("forms.vibe")
  const { ast, visitorKeys } = parseForESLint(code, { filePath: filename })
  const types = new Map()
  walk(ast, (node) => types.set(node.type, (types.get(node.type) ?? 0) + 1), visitorKeys)
  for (const type of Object.keys(vibeVisitorKeys)) assert.ok(types.has(type), `forms.vibe has no ${type}`)
  assert.equal(types.get("VibeProvideStatement"), 1)
  assert.equal(types.get("VibeServiceProvider"), 1)
  assert.equal(types.get("VibeCatchExpression"), 2)
  assert.equal(types.get("VibeMaskStatement"), 3)
  assert.equal(types.get("VibePipeExpression"), 3)
  assert.equal(types.get("TopicReference"), 3)
  assert.equal(types.get("VibeModuleDeclaration"), 1)
  // The parser's long forms that read as TypeScript stay TypeScript.
  for (const type of ["ArrowFunctionExpression", "ClassDeclaration", "TryStatement", "TSTypeLiteral"]) {
    assert.ok(types.has(type), `forms.vibe has no ${type}`)
  }
})

test("comments and JSDoc survive with their text and place", () => {
  const { code, filename } = fixture("forms.vibe")
  const { ast } = parseForESLint(code, { filePath: filename })
  const header = ast.comments[0]
  assert.equal(header.type, "Block")
  assert.match(header.value, /^\*\n \* Every form of the VibeLang cheat sheet/)
  assert.deepEqual(header.loc.start, { line: 1, column: 0 })
  const lines = ast.comments.filter((comment) => comment.type === "Line").map((comment) => comment.value)
  assert.deepEqual(lines, [" Declarations", " Contracts", " Programs"])
  const jsdoc = ast.comments.filter((comment) => comment.type === "Block" && comment.value.startsWith("*"))
  assert.equal(jsdoc.length, code.match(/\/\*\*/g).length)
})

test("the rules Smithers lints with find nothing in clean VibeLang", () => {
  assert.deepEqual(lint(fixture("forms.vibe")), [])
})

test("each seeded violation is reported on its line and UTF-16 column", () => {
  const found = lint(fixture("violations.vibe")).map(({ line, column, ruleId }) => `${line}:${column} ${ruleId}`)
  assert.deepEqual(found, [
    "7:26 import/no-duplicates",
    "8:1 @typescript-eslint/consistent-type-imports",
    "8:22 import/no-duplicates",
    "10:1 jsdoc/require-jsdoc",
    "10:35 @typescript-eslint/array-type",
    "11:7 prefer-const",
    "12:9 @typescript-eslint/no-unused-vars",
    "13:29 no-console",
    "24:28 no-restricted-syntax",
    "33:33 no-restricted-syntax",
    "44:35 @typescript-eslint/no-unused-vars",
    "46:5 no-var",
    "53:1 jsdoc/no-restricted-syntax"
  ])
})

test("fixes rewrite the .vibe text, and the result parses", () => {
  const { code, filename } = fixture("fixable.vibe")
  const result = new Linter({ configType: "flat", cwd: "/" }).verifyAndFix(code, config, { filename })
  assert.deepEqual(result.messages, [])
  assert.equal(result.output, fixture("fixable.expected.vibe").code)
  assert.doesNotThrow(() => parseForESLint(result.output, { filePath: filename }))
})

test("a syntax error is ESLint's parsing error at its line and column", () => {
  const [message] = lint(fixture("broken.vibe"))
  assert.equal(message.fatal, true)
  assert.equal(message.ruleId, null)
  assert.equal(message.message, "Parsing error: '}' expected.")
  assert.deepEqual([message.line, message.column], [4, 1])
})

test("the parser declares its name and version for ESLint's cache", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
  assert.deepEqual(vibelang.meta, { name: "vibelang/eslint", version: manifest.version })
})

test("names the parser writes are not variables a rule can report", () => {
  const code = "export function f(e: unknown) {\n  return match (e) {\n    when Exit.Success(let value): value;\n    default: 0;\n  }\n}\n"
  const { scopeManager } = parseForESLint(code, { filePath: "/f.vibe" })
  const names = scopeManager.scopes.flatMap((scope) => scope.variables.map((variable) => variable.name))
  assert.ok(names.includes("value"))
  assert.ok(!names.some((name) => name.startsWith("$")), names.join(", "))
})

test("a codec that a schema field names is used, wherever the field names it", () => {
  // foldkit-12: calendar/locale.vibe's twelveStrings and sevenStrings.
  const unused = (code) =>
    lint({ code, filename: "/locale.vibe" })
      .filter((message) => message.ruleId === "@typescript-eslint/no-unused-vars")
      .map((message) => `${message.line}:${message.message.match(/^'([^']+)'/)?.[1]}`)
  assert.deepEqual(unused("const Names = Schema.Tuple([Schema.String, Schema.String])\nexport schema Locale { names: Names }\n"), [])
  // Each place the schema mapping reads a reference, seeded so a failure names its program.
  const places = [
    (r) => `{ f: ${r} }`,
    (r) => `{ f?: ${r} }`,
    (r) => `{ readonly f: ${r} }`,
    (r) => `{ f: ReadonlyArray<${r}> }`,
    (r) => `{ f: Array<${r}> }`,
    (r) => `{ f: ${r}[] }`,
    (r) => `{ f: readonly [${r}, string] }`,
    (r) => `{ f: Record<string, ${r}> }`,
    (r) => `{ f: "a" | ${r} }`,
    (r) => `{ f: ${r} | null }`,
    (r) => `{ f: { g: ${r} } }`
  ]
  let seed = 12
  const next = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
  for (let i = 0; i < 60; i++) {
    let body = "Codec"
    for (let depth = 1 + next(3); depth > 0; depth--) body = places[next(places.length)](body)
    const form = [`export schema S ${body}`, `export schema S = ${body}`, `export schema error S ${body}`][next(3)]
    const code = `const Codec = Schema.String\nconst Unused = Schema.Number\n${form}\n`
    assert.deepEqual(unused(code), ["2:Unused"], code)
  }
})

test("a module declaration's body lints as TypeScript, on the .vibe file's lines and columns", () => {
  const { code, filename } = fixture("modules.vibe")
  assert.deepEqual(problems(code, parseForESLint(code, { filePath: filename }).ast, keys), [])
  const found = lint({ code, filename }).map(({ line, column, ruleId }) => `${line}:${column} ${ruleId}`)
  assert.deepEqual(found, [
    "18:30 @typescript-eslint/no-unused-vars",
    "29:31 @typescript-eslint/array-type",
    "30:9 prefer-const",
    "45:24 import/no-duplicates",
    "46:8 import/no-duplicates"
  ])
  // The body's eslint-disable comment is what keeps no-console quiet.
  const ignoringComments = new Linter({ configType: "flat", cwd: "/" }).verify(code, config, { filename, allowInlineConfig: false })
  assert.ok(ignoringComments.some(({ line, column, ruleId }) => `${line}:${column} ${ruleId}` === "32:5 no-console"))
})

// The rules that read scopes, which the TypeScript config turns off for
// .vibe files as for .ts files.
const scopeConfig = [{
  files: ["**/*.vibe"],
  languageOptions: { parser: vibelang, globals: { console: "readonly" } },
  linterOptions: { reportUnusedDisableDirectives: "off" },
  rules: { "no-redeclare": "error", "no-shadow": "error", "no-undef": "error" }
}]

test("a module declaration's body is a module scope of its own, beside the file's", () => {
  const { code, filename } = fixture("modules.vibe")
  const messages = new Linter({ configType: "flat", cwd: "/" }).verify(code, scopeConfig, { filename })
  // The body redeclares and shadows nothing, and cannot read the file's label.
  assert.deepEqual(messages.map(({ line, column, message }) => `${line}:${column} ${message}`), [
    "33:12 'label' is not defined."
  ])
  const { ast, scopeManager } = parseForESLint(code, { filePath: filename })
  const { globalScope } = scopeManager
  const module = ast.body.find((node) => node.type === "VibeModuleDeclaration")
  const body = scopeManager.acquire(module.body)
  const file = scopeManager.acquire(ast, true)
  assert.equal(body.type, "module")
  assert.equal(file.type, "module")
  assert.deepEqual(globalScope.childScopes, [file, body])
  const names = (scope) => scope.variables.map((variable) => variable.name).sort()
  assert.deepEqual(names(body), ["Effect", "Str", "prefix", "suffix", "tag", "tagged"])
  assert.deepEqual(names(file), ["label", "main", "prefix", "suffix", "tagged"])
  // Each import is read where it is declared.
  const lines = (variable) => variable.references.map((reference) => reference.identifier.loc.start.line)
  assert.deepEqual(lines(body.set.get("suffix")), [33])
  assert.deepEqual(lines(file.set.get("suffix")), [14])
  assert.deepEqual(lines(file.set.get("label")), [57])
  assert.ok(globalScope.through.some((reference) => reference.identifier.name === "label" && reference.identifier.loc.start.line === 33))
})

test("an identifier module specifier is the identifier written, with its name as source.value", () => {
  const { code, filename } = fixture("modules.vibe")
  const { ast } = parseForESLint(code, { filePath: filename })
  const sources = ast.body.filter((node) => node.source?.type === "Identifier").map(({ source }) => source)
  assert.deepEqual(sources.map((source) => [source.name, source.value, code.slice(...source.range)]), [
    ["text", "text", "text"], ["text", "text", "text"], ["text", "text", "text"], ["text", "text", "text"]
  ])
  assert.ok(!JSON.stringify(ast).includes(".text.js"))
})

// Rules that read an import's or an export's source.value.
const specifierConfig = [{
  files: ["**/*.vibe"],
  languageOptions: { parser: vibelang },
  plugins: { "@typescript-eslint": tseslint.plugin, import: importPlugin, unicorn },
  rules: {
    "no-duplicate-imports": "error",
    "no-restricted-imports": ["error", { paths: ["node:fs"] }],
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-import-type-side-effects": "error",
    "@typescript-eslint/no-restricted-imports": ["error", { paths: ["node:fs"] }],
    "@typescript-eslint/no-useless-empty-export": "error",
    "import/consistent-type-specifier-style": "error",
    "import/export": "error",
    "import/extensions": "error",
    "import/first": "error",
    "import/newline-after-import": "error",
    "import/no-absolute-path": "error",
    "import/no-cycle": "error",
    "import/no-duplicates": "error",
    "import/no-internal-modules": "error",
    "import/no-named-as-default": "error",
    "import/no-namespace": "error",
    "import/no-nodejs-modules": "error",
    "import/no-relative-packages": "error",
    "import/no-relative-parent-imports": "error",
    "import/no-self-import": "error",
    "import/no-unassigned-import": "error",
    "import/no-useless-path-segments": "error",
    "import/order": "error",
    "unicorn/import-style": "error",
    "unicorn/prefer-node-protocol": "error"
  }
}]

test("rules that read a module specifier's source.value lint identifier specifiers without a crash", () => {
  const cases = ["module-declaration", "module-declaration-cjs", "module-declaration-emit"]
    .map((name) => join(repo, "typescript/vibelang/cases", name, "main.vibe"))
  for (const filename of [fixture("modules.vibe").filename, ...cases]) {
    const code = readFileSync(filename, "utf8")
    const messages = new Linter({ configType: "flat", cwd: "/" }).verify(code, specifierConfig, { filename })
    assert.deepEqual(messages.filter((message) => message.fatal || /\.text\.js/.test(message.message)), [], filename)
  }
})

test("a syntax error in a module declaration's body is ESLint's parsing error at its line and column", () => {
  const code = "export const before = 1\n\nmodule text {\n  error Bad { reason: string }\n}\n"
  const [message] = lint({ code, filename: "/broken.vibe" })
  assert.equal(message.fatal, true)
  assert.equal(message.message, "Parsing error: Unexpected keyword or identifier.")
  assert.deepEqual([message.line, message.column], [4, 3])
})
