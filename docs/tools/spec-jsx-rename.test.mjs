import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// Loop round 4, ASTRA-2: VIP-39 reads `.vibex` as TypeScript reads `.tsx`,
// and TypeScript rejects an import of a `.tsx` file in a project without a
// `jsx` setting even when that file has no JSX. So renaming a JSX-free
// `x.vibe` to `x.vibex` is a parsing guarantee, not a project guarantee.
const vip = read("docs/design/vips/0039-vibex.md")

function diagnostics(files, options) {
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name, target) => name in files ? ts.createSourceFile(name, files[name], target, true) : undefined
  host.fileExists = (name) => name in files
  host.readFile = (name) => files[name]
  host.directoryExists = () => true
  host.getDirectories = () => []
  const program = ts.createProgram(["/main.ts"], { noLib: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, ...options }, host)
  return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()].map(d => d.code)
}

test("TypeScript reports TS6142 at an import of a JSX-free .tsx file without a jsx setting", () => {
  const main = { "/main.ts": "import { value } from \"./m\"\nexport const v = value\n" }
  assert.deepEqual(diagnostics({ ...main, "/m.ts": "export const value = 1\n" }, {}), [])
  assert.deepEqual(diagnostics({ ...main, "/m.tsx": "export const value = 1\n" }, {}), [6142])
  assert.deepEqual(diagnostics({ ...main, "/m.tsx": "export const value = 1\n" }, { jsx: ts.JsxEmit.Preserve }), [])
})

test("VIP-39's rename promise is about parsing and names the project settings", () => {
  assert.ok(!vip.includes("Renaming is safe both ways"))
  const bullet = vip.split("\n").find(l => l.startsWith("- **Renaming parses the same both ways.**"))
  assert.ok(bullet, "VIP-39 lost its rename bullet")
  assert.ok(bullet.includes("only where it has `<` in expression position or `</` (rows 1–5 and 39)"))
  assert.ok(bullet.includes("without `jsx`, an import of `x.vibex` is TS6142, and under `preserve` the output is `x.jsx`"))
  // The options bullet it points to says the same.
  assert.ok(vip.includes("A project without `jsx` gets `.tsx`'s errors (TS17004 at the element, TS6142 at the import)."))
})
