import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"
assert.equal(ts.version, "5.9.3")
for (const [file, count] of [["main", 2], ["shadow", 1], ["nested", 2]]) {
  for (const path of [`${file}.d.vibe.ts`, `out/${file}.d.ts`]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8")
    assert.ok(text.startsWith('/// <reference types="vibelang-runtime" />'))
    assert.equal((text.match(/static \[/g) || []).length, count)
  }
}
assert.ok(!readFileSync(new URL("out/plain.d.ts", import.meta.url), "utf8").includes("vibelang-runtime"))
const dir = fileURLToPath(new URL(".", import.meta.url))
const program = ts.createProgram([dir+"/consumer.ts"], { noEmit: true, strict: true, types: [], skipLibCheck: false, allowImportingTsExtensions: true, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 })
const diagnostics = ts.getPreEmitDiagnostics(program)
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {getCanonicalFileName: s => s, getCurrentDirectory: () => dir, getNewLine: () => "\n"}))
console.log("public matcher declarations check with stock TypeScript 5.9.3")
