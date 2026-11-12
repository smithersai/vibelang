// run-seconds: 60
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../../../../scripts/api-identity.mjs"

// main.vibe has no module body, so its declaration file is the one stock
// TypeScript writes for typescript/main.ts, byte for byte. Provider lives in
// lib.vibe's graph body; the owner re-exports it, as typescript/lib.ts
// declares it, so an inferred type names ./lib.js.
const ts = loadTypeScript()
const here = dirname(fileURLToPath(import.meta.url))
const twin = join(here, "typescript")
const program = ts.createProgram([join(twin, "main.ts")], {
  strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, types: [], skipLibCheck: true,
  declaration: true, emitDeclarationOnly: true, outDir: join(twin, "out"),
})
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
const written = new Map()
assert.equal(program.emit(undefined, (file, text) => written.set(file, text)).emitSkipped, false)
const want = written.get(join(twin, "out", "main.d.ts").replaceAll("\\", "/"))
assert.ok(want, [...written.keys()].join("\n"))
assert.equal(readFileSync(join(here, "out", "main.d.ts"), "utf8"), want)
console.log("body types in an inferred declaration name the owner module, as the TypeScript twin does")
