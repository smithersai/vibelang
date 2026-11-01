import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL(".", import.meta.url))
const root = fileURLToPath(new URL("../../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(root, "typescript/built/local/tsc")
const manifest = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8"))
const version = process.env.TS7_VERSION || manifest.devDependencies.typescript
const stock = join(root, "packages/ts-mapper/test/.cache", "typescript-" + version, "node_modules/.bin/tsc")
const require = createRequire(import.meta.url)
const ts = require(join(root, "docs/tools/node_modules/typescript"))
const config = {
  target: "ES2022", module: "ESNext", moduleResolution: "Bundler",
  strict: true, skipLibCheck: false, types: [], declaration: true,
  allowImportingTsExtensions: true, emitDeclarationOnly: true, outDir: "out"
}
const names = [
  ["plain", "./plain"],
  ["odd name", "./odd name"],
  ["odd'name", "./odd'name"],
  ['odd"name', './odd"name'],
  ["both'\"quotes", "./both'\"quotes"],
  ["café", "./caf\\u00e9"],
  ["model", "\\u002e\\u002fmodel"],
  ["星", "./\\u{661f}"],
]
function quote(text, q) {
  return q + text.replaceAll(q, "\\" + q) + q
}
function run(binary, project) {
  const result = spawnSync(binary, ["-p", project, "--pretty", "false"], { encoding: "utf8", timeout: 120000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, project + "\n" + result.stdout + result.stderr)
}
const errors = []
for (const style of [".js", ".ts", "extensionless"]) {
  for (const q of ['"', "'"]) {
    const fixture = join(dir, "out", style.replace(".", "") + (q === "'" ? "-single" : "-double"))
    mkdirSync(fixture, { recursive: true })
    let source = ""
    let consumer = 'import * as entry from "./entry.vibe"\n'
    const expected = []
    let i = 0
    for (const [name, spelling] of names) {
      for (const kind of ["vibe-js", "vibe-explicit", "native"]) {
        const native = kind === "native"
        const prefix = native ? "native-" : kind === "vibe-explicit" ? "explicit-" : ""
        const stem = prefix + name
        const path = spelling.replace(/^(\.\/|\\u002e\\u002f)/, (leading) => leading + prefix)
        const value = ++i
        writeFileSync(join(fixture, stem + (native ? ".ts" : ".vibe")), "export const value: " + value + " = " + value + "\nexport interface Shape { value: " + value + " }\n")
        if (native) writeFileSync(join(fixture, stem + ".vibe"), "export const value: 999 = 999\n")
        const specifier = quote(path + (native ? ".ts" : kind === "vibe-explicit" ? ".vibe" : ".js"), q)
        source += "export { value as v" + i + " } from " + specifier + "\nexport type T" + i + " = import(" + specifier + ").Shape\n"
        consumer += "const v" + i + ": " + value + " = entry.v" + i + "\nconst t" + i + ": entry.T" + i + " = { value: " + value + " }\n"
        expected.push("./" + stem + (native ? ".ts" : ".vibe"))
      }
    }
    writeFileSync(join(fixture, "entry.vibe"), source)
    writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify({
      compilerOptions: config, vibe: { effectGlobals: false, effectModules: false },
      vibelang: { declarationImportStyle: style }, files: ["entry.vibe"]
    }))
    run(compiler, fixture)
    const text = readFileSync(join(fixture, "entry.d.vibe.ts"), "utf8")
    const parsed = ts.createSourceFile("entry.d.ts", text, ts.ScriptTarget.Latest, true)
    const specifiers = []
    function visit(node) {
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) specifiers.push(node.moduleSpecifier)
      if (ts.isImportTypeNode(node)) specifiers.push(node.argument.literal)
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    try {
      assert.equal(parsed.parseDiagnostics.length, 0, text)
      assert.deepEqual(specifiers.map(s => s.text), expected.flatMap(s => [s, s]), text)
      for (const s of specifiers) assert.equal(text[s.getStart(parsed)], q, text)
    } catch (e) { errors.push(e.message) }
    writeFileSync(join(fixture, "consumer.ts"), consumer)
    writeFileSync(join(fixture, "consumer.json"), JSON.stringify({
      compilerOptions: { ...config, noEmit: true, emitDeclarationOnly: false, allowArbitraryExtensions: true },
      files: ["consumer.ts"]
    }))
    try { run(stock, join(fixture, "consumer.json")) } catch (e) { errors.push(e.message) }
    // Ordinary output declarations retain their portable contract too.
    writeFileSync(join(fixture, "out/output-consumer.ts"), consumer.replace("./entry.vibe", "./entry.js"))
    writeFileSync(join(fixture, "out/output-consumer.json"), JSON.stringify({
      compilerOptions: { ...config, noEmit: true, emitDeclarationOnly: false },
      files: ["output-consumer.ts"]
    }))
    try { run(stock, join(fixture, "out/output-consumer.json")) } catch (e) { errors.push(e.message) }

  }
}
assert.equal(errors.length, 0, errors.join("\n\n"))
console.log("escaped sidecar specifiers resolve")
