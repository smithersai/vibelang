import { compileProject } from "/Users/williamcory/effect-lang/poc/src/language/project-compile.ts"
import * as ts from "typescript-js"

const helper = `
export function double(value: number): number {
  return value * 2
}
`
const impl = `
import { Panic, panic } from "smithers:exceptions"
import { double } from "./helper.sm"
class Missing extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(
  input: { mode: string; value: number }
): Result<{ value: number }, Missing | Panic> {
  if (input.mode === "typed") throw new Missing("missing")
  if (input.mode === "panic") panic("unexpected")
  return { value: double(input.value) }
}
`
const result = compileProject(
  [
    { fileName: "impl.sm", source: impl },
    { fileName: "helper.sm", source: helper }
  ],
  { outDir: "/tmp/probe-out", runtimeImport: "smithers-runtime", sourceMap: false }
)
console.log("diagnostics:", result.diagnostics)
for (const [name, file] of Object.entries(result.files)) {
  console.log("=== emitted TS:", name)
  console.log(file.code)
  const transpiled = ts.transpileModule(file.code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      removeComments: true
    },
    fileName: name + ".ts",
    reportDiagnostics: true
  })
  console.log("=== CJS:", name)
  console.log(transpiled.outputText)
  console.log("=== diags:", transpiled.diagnostics?.length)
}
