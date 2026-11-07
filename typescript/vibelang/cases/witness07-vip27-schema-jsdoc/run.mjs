// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

assert.equal(ts.version, "5.9.3")
const dir = process.cwd()
const base = {
  strict: true, skipLibCheck: true, target: "ES2022", module: "NodeNext", types: [],
  declaration: true, emitDeclarationOnly: true,
}
const variants = { default: {}, removeComments: { removeComments: true }, stripInternal: { stripInternal: true },
  both: { removeComments: true, stripInternal: true },
}
const declarations = {}

for (const [name, extra] of Object.entries(variants)) {
  const outDir = join(dir, "out", "variants", name)
  mkdirSync(outDir, { recursive: true })
  const config = join(outDir, "tsconfig.json")
  writeFileSync(config, JSON.stringify({ compilerOptions: { ...base, ...extra, rootDir: dir, outDir: "." }, files: [join(dir, "main.vibe")] }))
  const fork = spawnSync(process.env.VIBELANG_BINARY, ["-p", config, "--pretty", "false"], { encoding: "utf8", timeout: 30_000 })
  assert.ifError(fork.error)
  assert.equal(fork.status, 0, name + ": " + fork.stdout + fork.stderr)
  const actual = readFileSync(join(outDir, "main.d.ts"), "utf8")

  const program = ts.createProgram([join(dir, "typescript/main.ts")], {
    ...base, ...extra, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022, outDir: join(dir, "typescript/out"),
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [], name + ": stock tsc accepts the twin")
  let expected
  const emitted = program.emit(undefined, (file, text) => { if (file.endsWith("main.d.ts")) expected = text })
  assert.equal(emitted.emitSkipped, false)
  assert.equal(actual, expected, name + ": schema declaration output equals stock tsc on the Effect TypeScript pair")
  declarations[name] = actual
}

// The comment rides on the constant; the synthesized alias line right after it has none.
const lines = declarations.default.split("\n")
for (const schema of ["User", "Legacy", "Code", "Name"]) {
  const constant = lines.findIndex(line => line.startsWith(`export declare const ${schema}:`))
  assert.ok(constant > 0 && lines[constant - 1].trim().endsWith("*/"), schema + " constant keeps its JSDoc")
  const alias = lines.findIndex(line => line === `export type ${schema} = typeof ${schema}.Type;`)
  assert.ok(alias > constant, schema + " alias follows its constant")
  assert.ok(!lines[alias - 1].trim().endsWith("*/"), schema + " alias has no comment")
}
assert.match(declarations.default, /@deprecated Use User\./)
assert.match(declarations.default, /@internal/)
// removeComments drops every comment; stripInternal removes the @internal constant and keeps its bare alias, as tsc does.
assert.doesNotMatch(declarations.removeComments, /\/\*\*/)
assert.doesNotMatch(declarations.stripInternal, /export declare const Code/)
assert.match(declarations.stripInternal, /export type Code = typeof Code\.Type;/)
assert.doesNotMatch(declarations.both, /\/\*\*|export declare const Code/)
console.log("schema JSDoc and native comment options match TypeScript")
