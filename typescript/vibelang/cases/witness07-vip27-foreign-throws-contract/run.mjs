// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

assert.equal(ts.version, "5.9.3")
const dir = process.cwd()
const options = { strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, declaration: true, emitDeclarationOnly: true, outDir: join(dir, "typescript/out") }
const program = ts.createProgram(["annotated.ts", "plain.ts"].map(file => join(dir, "typescript", file)), options)
assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [])
const stock = {}
assert.equal(program.emit(undefined, (file, text) => { stock[file.split("/").pop()] = text }).emitSkipped, false)

// Stock tsc keeps a written `@throws {never}` in the declaration; without it,
// the same function type has no JSDoc at all.
assert.equal(stock["annotated.d.ts"], "/** @throws {never} */\nexport declare function add(a: number, b: number): number;\n")
assert.equal(stock["plain.d.ts"], "export declare function add(a: number, b: number): number;\n")
// The plain `.vibe` function's declaration is the annotated twin's, not the unannotated one.
const vibe = readFileSync(join(dir, "out/main.d.ts"), "utf8")
assert.equal(vibe, stock["annotated.d.ts"])

// A VibeLang consumer of the three declarations, compiled with this compiler.
const consumer = join(dir, "out/consumer")
mkdirSync(consumer, { recursive: true })
writeFileSync(join(consumer, "package.json"), '{"type":"module"}')
writeFileSync(join(consumer, "annotated.d.ts"), stock["annotated.d.ts"])
writeFileSync(join(consumer, "plain.d.ts"), stock["plain.d.ts"])
writeFileSync(join(consumer, "generated.d.ts"), vibe)
writeFileSync(join(consumer, "main.vibe"), [
  'import { add as annotated } from "./annotated.js"',
  'import { add as plain } from "./plain.js"',
  'import { add as generated } from "./generated.js"',
  "export effect function viaAnnotated() { return annotated(1, 2) }",
  "export effect function viaGenerated() { return generated(1, 2) }",
  "export effect function viaPlain() { return plain(1, 2) }",
  "",
].join("\n"))
writeFileSync(join(consumer, "tsconfig.json"), JSON.stringify({
  compilerOptions: { strict: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", types: [], noEmit: true },
  files: ["main.vibe"],
}))
const compiled = spawnSync(process.env.VIBELANG_BINARY, ["-p", consumer, "--pretty", "false"], { encoding: "utf8", timeout: 60_000 })
assert.ifError(compiled.error)
// rule-evidence: docs/design/vips/0004-throw.md#decision | `@throws {T}` means it throws `T`, and no `@throws` means it throws `unknown`.
// rule-evidence: docs/design/src/003-failures.md#plain-code-never-throws | A call whose throwing is unknown, such as an unannotated `.ts` function, stays an ordinary call (VIP-40); in effect code the same call has thrown type `unknown` and needs its wrapper (`EK0403`).
// Only the unannotated foreign callable has thrown type `unknown`; the annotated
// twin and the generated declaration both advertise `never`.
const errors = [...compiled.stdout.matchAll(/^(?:.*\/)?main\.vibe\((\d+),\d+\): error (\w+)/gm)].map(m => m[1] + ":" + m[2])
assert.deepEqual(errors, ["6:EK0403"], compiled.stdout + compiled.stderr)
console.log("generated throws contract matches the annotated twin")
