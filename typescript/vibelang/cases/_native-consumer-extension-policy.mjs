import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

// VIP-27 / chapter 7: intrinsic sources follow the .ts/.tsx twin's source
// extension checks. Stock tsc consuming only a .d.vibe.ts is a different
// program: allowArbitraryExtensions says nothing about a live source input.
export function nativeConsumerExtensionPolicy(mode) {
  assert.equal(ts.version, "5.9.3")
  const profiles = [
    ["default", {}],
    ["rewrite-false", { rewriteRelativeImportExtensions: false }],
    ["rewrite", { rewriteRelativeImportExtensions: true }],
    ["rewrite-allow-false", { rewriteRelativeImportExtensions: true, allowImportingTsExtensions: false }],
    ["check-allow", { noEmit: true, allowImportingTsExtensions: true }],
    ["check-default", { noEmit: true }],
    ["declaration-allow", { declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true }],
    ["type-only", {}, true],
  ]
  let checked = 0
  for (const extension of [".vibe", ".vibex"]) for (const importer of [".ts", ".tsx"]) {
    for (const [profile, extra, typeOnly] of profiles) for (const arbitrary of [false, true]) {
      const key = [mode, extension, importer, profile, arbitrary].join("/")
      const dir = mkdtempSync(join(tmpdir(), "native-consumer-policy-"))
      const put = (name, text) => { mkdirSync(dirname(join(dir, name)), { recursive: true }); writeFileSync(join(dir, name), text) }
      try {
        const twin = extension === ".vibe" ? ".ts" : ".tsx"
        const source = typeOnly
          ? 'import type { Value } from "./nested/producerEXT"; export const answer: Value = 42;'
          : 'import { value } from "./nested/producerEXT"; export { value as again } from "./nested/producerEXT"; export const answer: 42 = value; export const load = () => import("./nested/producerEXT");'
        const producer = "export const value = 42 as const; export type Value = 42;"
        const options = { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, jsx: "preserve", outDir: "out", allowArbitraryExtensions: arbitrary, ...extra }
        put("package.json", '{"type":"module"}')
        put("nested/producer" + extension, producer)
        // A stale compatibility declaration must not replace the intrinsic source.
        put("nested/producer.d" + extension + ".ts", "export declare const value: 0; export type Value = 0;")
        put("consumer" + importer, source.replaceAll("EXT", extension))
        put("tsconfig.json", JSON.stringify({ compilerOptions: options, files: ["consumer" + importer], vibe: { effectGlobals: false, effectModules: false } }))
        put("nested/producer" + twin, producer)
        put("control" + importer, source.replaceAll("EXT", twin))
        const stock = ts.createProgram([join(dir, "control" + importer)], { ...ts.convertCompilerOptionsFromJson(options, dir).options, outDir: join(dir, "stock") })
        const expected = ts.getPreEmitDiagnostics(stock).map(d => d.code).sort((a, b) => a - b)
        stock.emit()
        const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 30000 })
        assert.ifError(r.error)
        assert.equal(r.signal, null, key)
        const text = r.stdout + r.stderr
        const actual = [...text.matchAll(/error TS(\d+):/g)].map(m => Number(m[1])).sort((a, b) => a - b)
        assert.doesNotMatch(text, /error EK\d+:/, key + "\n" + text)
        assert.deepEqual(actual, expected, key + "\n" + text)
        assert.equal(r.status === 0, expected.length === 0, key + "\n" + text)
        if (mode === "output") {
          const name = "consumer" + (importer === ".tsx" ? ".jsx" : ".js")
          const control = "control" + (importer === ".tsx" ? ".jsx" : ".js")
          const emitted = join(dir, "out", name), native = join(dir, "stock", control)
          assert.equal(existsSync(emitted), existsSync(native), key)
          if (existsSync(native)) {
            const imports = file => {
              const result = []
              const visit = node => {
                if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) result.push(node.moduleSpecifier.text)
                if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text)
                ts.forEachChild(node, visit)
              }
              visit(ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true))
              return result
            }
            assert.deepEqual(imports(emitted), imports(native).map(s => s.replaceAll("producer" + twin, "producer" + extension)), key)
          }
        }
        checked++
      } catch (error) { error.message = key + ": " + error.message; throw error }
      finally { rmSync(dir, { recursive: true, force: true }) }
    }
  }
  console.error(JSON.stringify({ stage: "native-extension-policy", mode, stock: ts.version, checked }))
}
