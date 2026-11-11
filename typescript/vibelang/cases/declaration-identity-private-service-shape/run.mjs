// A stock TypeScript consumer checks the declaration files themselves
// (skipLibCheck: false): every Name.Shape they write must name a declared or
// imported service, and its type must be the shape, not an error type.
import assert from "node:assert/strict"
import { rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

const dir = dirname(fileURLToPath(import.meta.url))
const options = {
  noEmit: true,
  strict: true,
  skipLibCheck: false,
  types: [],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ES2022,
}
const check = (name, text) => {
  const file = join(dir, name)
  writeFileSync(file, text)
  try {
    // The case's own files only: Effect's declarations are not under test.
    const program = ts.createProgram([file], options)
    assert.deepEqual(program.getGlobalDiagnostics().concat(program.getOptionsDiagnostics()), [])
    return [file, join(dir, "out/main.d.ts"), join(dir, "out/ledger.d.ts")]
      .flatMap((name) => {
        const source = program.getSourceFile(name)
        assert.ok(source, name)
        return program.getSyntacticDiagnostics(source).concat(program.getSemanticDiagnostics(source))
      })
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`)
  } finally {
    rmSync(file, { force: true })
  }
}
const imports = 'import { a, annotated, fakeLedger, Inner, Box } from "./out/main.js"\nimport type { Alias, Wide } from "./out/main.js"\n'
assert.deepEqual(
  check(
    "consumer-accepted.ts",
    imports +
      "export const v: number = a.v\nexport const z: number = annotated({ z: 1 })[0]!.z\n" +
      "export const total: number = fakeLedger.total\nexport const h: number = Inner.hidden.h\n" +
      "export const alias: Alias = { v: 2 }\nexport const wide: Wide = { z: 1, extra: 2 }\nexport const inner: number = new Box().inner.v\n",
  ),
  [],
)
// An undeclared namespace makes each of these any, which accepts everything.
const rejected = check(
  "consumer-rejected.ts",
  imports +
    "export const v: string = a.v\nexport const z: string = annotated({ z: 1 })[0]!.z\n" +
    "export const total: string = fakeLedger.total\nexport const h: string = Inner.hidden.h\n" +
    'export const alias: Alias = { v: "2" }\nexport const wide: Wide = { z: "1", extra: 2 }\nexport const inner: string = new Box().inner.v\n',
)
assert.deepEqual(rejected.map((d) => d.slice(0, 6)), Array(7).fill("TS2322"), rejected.join("\n"))
console.log("private service shapes declared")
