import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { splitBatchPlatform } from "../../../../../../.smithers/flows/migrate/lib/platform.mjs"
import { materialize, restore, statements } from "../../../../../../.smithers/flows/migrate/test/helpers/host-operations-oracle.mjs"
const require = createRequire(new URL("../../../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const corpus = JSON.parse(readFileSync(new URL("../corpus/t3code-existing-platform-module-body.json", import.meta.url), "utf8"))
const [key, rawMode] = process.argv.slice(2), mode = Number(rawMode) & 15
const file = (mode & 1 ? "src/nested/space δ/" : "src/") + "host." + (mode & 2 ? "mts" : "ts")
const sibling = file.replace(/\.(m?ts)$/, ".platform.$1")
let source = corpus.native
if (mode & 8) source = source.replace("process.cwd()", "process.platform")
if (key === "metadata-existing") source += "export const origin = import.meta.url;\n"
if (mode & 4) source = source.replaceAll("\n", "\r\n")
// VIP-40 permits copied declarations or extracted host-operation helpers.
// Compare the original statements after undoing those mechanical boundaries;
// runtime and full declaration qualification belong to the compiler's suites.
function preservesCopy(after) {
 const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
 const parse = text => ts.createSourceFile("copy.ts", text.replaceAll("\r\n", "\n"), ts.ScriptTarget.Latest, true)
 const original = parse(source)
 const extracted = materialize(after.replaceAll("\r\n", "\n"), "./inline-body.ts")
 const body = parse(extracted.body), outer = parse(extracted.module)
 if ([original, body, outer].some(file => file.parseDiagnostics.length)) return false
 const print = (node, file) => printer.printNode(ts.EmitHint.Unspecified, node, file).trim()
 const synthetic = node => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier?.text === "./inline-body.ts"
 const originals = original.statements.map(node => print(node, original)).sort()
 const copies = [...body.statements.map(node => print(node, body)), ...outer.statements.filter(node => !synthetic(node)).map(node => print(node, outer))].sort()
 const bodyExports = body.statements.filter(node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  .flatMap(node => ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.text) : [node.name?.text]).sort()
 const forwarded = outer.statements.filter(node => ts.isExportDeclaration(node) && synthetic(node))
  .flatMap(node => node.exportClause?.elements?.map(e => (e.propertyName?.text ?? e.name.text) === e.name.text ? e.name.text : null) ?? []).sort()
 if (JSON.stringify(copies) === JSON.stringify(originals) && JSON.stringify(forwarded) === JSON.stringify(bodyExports)) return true
 // Existing host-operation fixtures restore their copied accessors explicitly.
 const restored = statements(restore(after.replaceAll("\r\n", "\n")))
 const before = statements(source.replaceAll("\r\n", "\n"))
 const imports = file => file.statements.filter(ts.isImportDeclaration).map(node => print(node, file)).sort()
 const allImports = [...imports(body), ...outer.statements.filter(node => ts.isImportDeclaration(node) && !synthetic(node)).map(node => print(node, outer))].sort()
 return JSON.stringify(restored) === JSON.stringify(before) && JSON.stringify(allImports) === JSON.stringify(imports(original))
}
function observe(existing, moduleBodies) {
 const files = new Map([["package.json", JSON.stringify({ private: true, exports: { "./*": "./src/*.ts" } })], [file, source]])
 if (existing) files.set(sibling, corpus.sibling)
 const beforeManifest = files.get("package.json"), writes = []
 const result = splitBatchPlatform(resolve("virtual-platform-fixture"), [file], ts, {
  moduleBodies, globalsOf: () => ["process"],
  exists: path => files.has(path),
  read: path => { if (!files.has(path)) throw Error("missing fixture input: " + path); return files.get(path) },
  write: (path, text) => { writes.push(path); files.set(path, text) },
  returnsAvoidOf: () => null,
 })
 const after = files.get(file), inline = result.splits.length === 1 && result.splits[0].platform === null && Boolean(result.splits[0].module)
 let copyPreserved = false
 if (inline) copyPreserved = preservesCopy(after)
 return { result, inline, copyPreserved, sourceChanged: after !== source,
  siblingUnchanged: existing ? files.get(sibling) === corpus.sibling : !files.has(sibling),
  manifestUnchanged: beforeManifest === files.get("package.json"),
  writes, onlySourceWritten: writes.every(path => path === file), after }
}
const control = observe(false, true)
const actual = observe(key !== "body-absent", key !== "sibling-existing")
console.log(JSON.stringify({ key, mode, file, sibling, control, actual }))
