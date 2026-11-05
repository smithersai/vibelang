import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const require = createRequire(join(process.cwd(), "packages/runtime/package.json"))
const ts = require("typescript")
const { addSourceChildLoaders } = await import(pathToFileURL(join(process.cwd(), ".smithers/flows/migrate/lib/source-children.mjs")))
const corpus = JSON.parse(readFileSync(new URL("../corpus/t3code-source-child-project-lint.json", import.meta.url)))
let raw = ""
for await (const chunk of process.stdin) raw += chunk
const { key, mode } = JSON.parse(raw)
const variant = key.split(":")[1], file = variant === "js" ? "launch.js" : "launch.mjs"
const source = (mode & 1 ? "// launcher\n" : "") +
  (variant === "existing-url" ? 'import * as NodeURL from "node:url";\nexport const shown = NodeURL.fileURLToPath(import.meta.url);\n' : "") + corpus.source
function policy(text) {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (parsed.parseDiagnostics.length) throw Error("unparsable source-child fixture")
  const issues = []
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "node:url") continue
    const binding = statement.importClause?.namedBindings
    if (!binding || !ts.isNamespaceImport(binding) || binding.name.text !== corpus.namespace) issues.push("namespace-node-imports")
  }
  // Model the two reported project rules, rather than depending on the
  // target application's build or importing its private plugin.
  if ((text.match(/\/\*\*[\s\S]*?\*\//g) ?? []).some(comment => comment.split(/\r\n|\r|\n/).length > corpus.maxCommentLines)) {
    issues.push("no-low-value-comments")
  }
  return issues
}
const result = addSourceChildLoaders(source, ts, { file })
console.log(JSON.stringify({ before: policy(source), after: policy(result.text), refusals: result.refusals, usesChild: result.usesChild, unchanged: result.text === source }))
