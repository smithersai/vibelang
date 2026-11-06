// VIP-42: this is evidence of the current open prelude question, not a new prelude rule.
import assert from "node:assert/strict"
import { readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

const root = fileURLToPath(new URL(".", import.meta.url))
const output = join(root, "out")
const stock = join(output, "stock")
mkdirSync(stock, { recursive: true })
try {
  writeFileSync(join(stock, "package.json"), '{"type":"module"}')
  const options = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    strict: true, types: [], skipLibCheck: true, declaration: true, noEmitOnError: true, outDir: stock
  }
  const program = ts.createProgram([join(root, "main.ts")], options)
  const result = program.emit()
  assert.deepEqual([...ts.getPreEmitDiagnostics(program), ...result.diagnostics].map(d => d.code), [])
  assert.equal(result.emitSkipped, false)
  const vibeJS = readFileSync(join(output, "main.js"), "utf8")
  const stockJS = readFileSync(join(stock, "main.js"), "utf8")
  assert.match(vibeJS, /effect\/Request/)
  assert.doesNotMatch(stockJS, /effect\/Request/)
  assert.notEqual(readFileSync(join(output, "main.d.ts"), "utf8"), readFileSync(join(stock, "main.d.ts"), "utf8"))
  const native = await import(pathToFileURL(join(output, "main.js")).href)
  const ordinary = await import(pathToFileURL(join(stock, "main.js")).href)
  assert.equal(typeof native.request, "object")
  assert.equal(typeof ordinary.request, "function")
  assert.equal(ordinary.request, globalThis.Request)
  console.log("stock and VibeLang accept different Request bindings")
} finally {
  rmSync(stock, { recursive: true, force: true })
}
