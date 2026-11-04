import assert from "node:assert/strict"
import test from "node:test"
import ts from "typescript"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { chapter, read, tools } from "./spec-witness.mjs"

// VIP-27/VIP-30: source/twin options determine declarations. Compatibility
// sidecars preserve VibeLang identity and are not ordinary package output.
const clauses = [
  "Declaration emit follows TypeScript for the source’s `.ts`/`.tsx` twin",
  "The twin uses the same tsconfig, without enabling extension flags",
  "Synthesized import types use TypeScript’s spelling for the twin",
  "Compatibility sidecars instead keep VibeLang source references",
  "Neither `allowImportingTsExtensions` nor `rewriteRelativeImportExtensions` rewrites declaration specifiers",
  "JavaScript output rewriting is separate",
  "No declaration spelling setting exists",
]
function checkEmitContract(text) {
  for (const clause of clauses) assert.ok(text.includes(clause), clause)
}
test("emit names follow native twin options and keep compatibility sidecars distinct", () => {
  checkEmitContract(chapter("001-functions"))
  assert.match(chapter("007-tooling"), /`declarationImportStyle` is retired/)
  assert.match(chapter("007-tooling"), /nonfatal deprecation warning `EK3011` for every value/)
  assert.match(read("docs/design/vips/0034-compiler-and-tooling.md"), /declaration import spelling follows TypeScript/)
})
test("mutations cannot remove native spelling, options or sidecar identity", () => {
  const text = chapter("001-functions")
  fc.assert(fc.property(fc.constantFrom(...clauses), clause => {
    assert.throws(() => checkEmitContract(text.replaceAll(clause, "[removed]")))
  }), { seed: 1104116, numRuns: 200 })
})

const options = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] }
const errors = diagnostics => diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).map(d => d.code + ": " + ts.flattenDiagnosticMessageText(d.messageText, "\n"))

test("packed native declarations resolve in a stock TypeScript consumer", () => {
  const scratch = mkdtempSync(join(tools, ".native-declaration-package-"))
  try {
    for (const [i, extension] of [".ts", ".js", ""].entries()) {
      const root = join(scratch, String(i)), pkg = join(root, "package"), src = join(pkg, "src"), dist = join(pkg, "dist"), consumer = join(root, "consumer")
      mkdirSync(src, { recursive: true }); mkdirSync(consumer, { recursive: true })
      writeFileSync(join(src, "user.ts"), "export interface User { id: number }\n")
      const specifier = "./user" + extension
      writeFileSync(join(src, "index.ts"), 'import type { User } from "' + specifier + '"; export const user: User = { id: 1 };\n')
      const program = ts.createProgram([join(src, "index.ts"), join(src, "user.ts")], {
        ...options, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true, rootDir: src, outDir: dist
      })
      assert.deepEqual(errors(ts.getPreEmitDiagnostics(program)), [])
      assert.deepEqual(errors(program.emit().diagnostics), [])
      assert.ok(readFileSync(join(dist, "index.d.ts"), "utf8").includes(specifier))
      writeFileSync(join(pkg, "package.json"), JSON.stringify({
        name: "native-declaration-probe", version: "1.0.0", type: "module", types: "./dist/index.d.ts",
        exports: { ".": { types: "./dist/index.d.ts" } }, files: ["dist"]
      }))
      const env = { ...process.env, npm_config_cache: join(scratch, "npm-cache") }
      const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], { cwd: pkg, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))
      writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { "native-declaration-probe": "file:" + join(root, packed[0].filename) } }))
      execFileSync("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], { cwd: consumer, env, stdio: "pipe" })
      writeFileSync(join(consumer, "index.ts"), 'import { user } from "native-declaration-probe"; const value: number = user.id;\n')
      const consumed = ts.createProgram([join(consumer, "index.ts")], { ...options, noEmit: true })
      assert.deepEqual(errors(ts.getPreEmitDiagnostics(consumed)), [], specifier)
    }
  } finally { rmSync(scratch, { recursive: true, force: true }) }
})

test("native JavaScript rewrites remain separate from declaration spelling", () => {
  fc.assert(fc.property(fc.boolean(), fc.constantFrom(".ts", ".tsx", ".js", ".jsx"), (rewrite, extension) => {
    const specifier = "./value" + extension
    const source = 'export { value } from "' + specifier + '";'
    const compilerOptions = { ...options, jsx: ts.JsxEmit.Preserve, rewriteRelativeImportExtensions: rewrite }
    const declaration = ts.transpileDeclaration(source, { fileName: "index.ts", compilerOptions, reportDiagnostics: true })
    assert.deepEqual(errors(declaration.diagnostics), [])
    assert.ok(declaration.outputText.includes(specifier))
    const js = ts.transpileModule(source, { compilerOptions }).outputText
    const emitted = rewrite ? specifier.replace(/\.tsx$/, ".jsx").replace(/\.ts$/, ".js") : specifier
    assert.ok(js.includes(emitted), js)
  }), { seed: 1104117, numRuns: 120 })
})
