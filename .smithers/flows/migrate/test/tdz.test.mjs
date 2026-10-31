import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"

const lib = fileURLToPath(new URL("../lib/", import.meta.url))
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])

// A binding used before its declaration in its scope throws when the code
// runs: d75b90ff's `const paths = …` in setup shadowed the paths() that
// setup calls first, so every setup failed with "Cannot access 'paths'
// before initialization", and no test ran setup. TypeScript's checker finds
// each such use statically in the flow's JavaScript.
const beforeDeclaration = new Set([2448, 2449, 2450, 2454])

test("no module of the flow uses a binding before its declaration", () => {
  const files = readdirSync(lib).filter((f) => f.endsWith(".mjs")).map((f) => join(lib, f))
  const program = ts.createProgram({ rootNames: files, options: { allowJs: true, checkJs: true, noEmit: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ESNext, types: [], skipLibCheck: true } })
  const found = files.flatMap((file) => program.getSemanticDiagnostics(program.getSourceFile(file)))
    .filter((d) => beforeDeclaration.has(d.code))
    .map((d) => `${d.file.fileName.slice(lib.length)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  assert.deepEqual(found, [])
})
