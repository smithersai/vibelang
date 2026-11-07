// A property assigned more than once on a function is declared once in the
// function's namespace, with the type TypeScript gives it: the union of what
// is assigned. Stock TypeScript must accept the emitted declarations, and each
// property's type must be assignable both ways to its type in the twin source.
import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { result } from "./out/main.js"

const require = createRequire(process.env.VIBELANG_RUNTIME + "/package.json")
const ts = require("typescript")
const here = (name) => fileURLToPath(new URL(name, import.meta.url))
const properties = ["same", "mixed", "aliases", "count", "label"]
const checks = (module) => properties.map((p) =>
  `export const ${module}_${p}: Same<typeof Source.f.${p}, typeof ${module}.f.${p}> = true`).join("\n")
writeFileSync(here("./out/consumer.ts"), [
  `import * as Source from "../twin.js"`,
  `import * as Vibe from "./main.js"`,
  `import * as Twin from "./twin.js"`,
  `type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false`,
  checks("Vibe"),
  checks("Twin"),
  `export const calls: number[] = [Vibe.f(), Twin.f()]`,
  ""
].join("\n"))
const program = ts.createProgram([here("./out/consumer.ts")], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: [],
  noEmit: true,
  skipLibCheck: false
})
const diagnostics = ts.getPreEmitDiagnostics(program).map((d) => {
  const where = d.file ? `${d.file.fileName.slice(d.file.fileName.lastIndexOf("/") + 1)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : ""
  return `${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`
})
assert.deepEqual(diagnostics, [])
assert.deepEqual(result, [1, 3, 2, "b"])
console.log("ok")
