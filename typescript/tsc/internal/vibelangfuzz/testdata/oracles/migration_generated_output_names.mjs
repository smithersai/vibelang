import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const root = process.cwd()
const require = createRequire(join(root, "packages/runtime/package.json"))
const ts = require("typescript")
const { rewriteSourceLiterals } = await import(pathToFileURL(join(root, ".smithers/flows/migrate/lib/source-paths.mjs")))
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 7
const extension = mode & 2 ? "tsx" : "ts", native = mode & 2 ? "vibex" : "vibe"
const quote = mode & 1 ? "'" : '"'
const name = "index." + extension, from = "packages/codegen/src/" + name
const to = from.replace(/\.(tsx|ts)$/, "." + native)
const descriptor = "{ path: " + quote + name + quote + ', content: "export const value = 1;\\n" }'
const declarations = "declare const fs: { writeFileString(path: string, content: string): unknown };\ndeclare const directory: string;\ndeclare function join(...parts: string[]): string;\n"
const cases = {
  array: declarations + "const files = [" + descriptor + "];\nfor (const file of files) fs.writeFileString(join(directory, file.path), file.content);\n",
  object: declarations + "const file = " + descriptor + ";\nfs.writeFileString(join(directory, file.path), file.content);\n",
  returned: declarations + "function build() { return [" + descriptor + "]; }\nfor (const file of build()) fs.writeFileString(join(directory, file.path), file.content);\n",
  nested: declarations + "const output = { files: [" + descriptor + "] };\nfor (const file of output.files) fs.writeFileString(join(directory, file.path), file.content);\n"
}
assert.ok(Object.hasOwn(cases, key))
let original = cases[key]
if (key === "array" && mode === 0) {
  const corpus = readFileSync(join(root, "typescript/tsc/internal/vibelangfuzz/testdata/corpus/opencode-generated-output-descriptor.ts"), "utf8")
  assert.equal(corpus, original, "minimized output writer must match its generator")
  original = corpus
}
original += "import { readFileSync } from 'node:fs';\nconst source = readFileSync(" + quote + name + quote + ', "utf8");\n'
if (mode & 4) original = original.replaceAll("\n", "\r\n")
const rewritten = rewriteSourceLiterals(ts, original, from, [{ from, to }], { inventory: [from] })
function inspect(text) {
  const source = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.deepEqual(source.parseDiagnostics, [])
  const outputs = [], reads = []
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.text === "path" && ts.isStringLiteral(node.initializer)) outputs.push(node.initializer.text)
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "readFileSync") reads.push(node.arguments[0].text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { outputs, reads }
}
const before = inspect(original), after = inspect(rewritten.text)
assert.deepEqual(before.outputs, [name])
assert.deepEqual(before.reads, [name])
assert.deepEqual(after.reads, ["index." + native], "real source read must still follow its source rename")
console.log(JSON.stringify({
  ok: JSON.stringify(after.outputs) === JSON.stringify(before.outputs),
  key, extension, before: before.outputs, after: after.outputs, sourceRead: after.reads,
  edits: rewritten.edits.map(({ kind, from, to, context }) => ({ kind, from, to, context }))
}))
