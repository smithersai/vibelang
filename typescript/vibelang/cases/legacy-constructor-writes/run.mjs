import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { f, result } from "./out/main.js"

const require = createRequire(process.env.VIBELANG_RUNTIME + "/package.json")
const ts = require("typescript")
const program = ts.createProgram(
  [fileURLToPath(new URL("./reference.ts", import.meta.url))],
  {
    strict: true,
    strictNullChecks: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    types: [],
    skipLibCheck: true,
    outDir: fileURLToPath(new URL("./out/stock", import.meta.url))
  }
)
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
assert.equal(program.emit().emitSkipped, false)
const control = await import("./out/stock/reference.js")
assert.deepEqual(
  [f(), result, f.constructor === Function],
  [control.f(), control.result, control.f.constructor === Function]
)
assert.deepEqual([f(), result, f.constructor === Function], [1, 1, true])
console.log("ok")
