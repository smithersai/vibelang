import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { canonicalize, loadTypeScript } from "../lib/declarations.mjs"
import { markPlainFunctions, toolchainKeepsFunctionsPlain } from "../lib/plain.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

// The oracle is the identity gate itself: a .ts module of plain helpers and
// their top-level callers, marked and renamed to .vibe, compiles with no
// error and declares exactly what TypeScript declares for the original
// (chapter 1: a plain function's call gives its result, as in TypeScript).
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const runtime = join(repo, "packages/runtime")
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const missing = [native, join(modules, "effect")].find((path) => !existsSync(path))
const skip = missing !== undefined && `build the compiler and link experiments/node_modules first; missing ${missing}`
const quote = "| plain | `function f() { }`, `() => …` | its result, as in TypeScript | TypeScript |"
const options = { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, emitDeclarationOnly: true, outDir: "out" }

const bodies = {
  brand: () => 'Schema.String.pipe(Schema.brand("Id"))',
  struct: () => "Schema.Struct({ id: Schema.String })",
  array: (v) => `[${v}].map((x) => x + 1)`,
  object: (v) => `({ ${v}, twice: ${v} * 2 })`,
  text: (v) => "`id-${" + v + "}`",
  layer: (v) => `Layer.succeed(Port, { n: ${v} })`,
  stream: (v) => `Stream.make(${v}, ${v} + 1)`,
  error: (v) => `new Failed({ n: ${v} })`,
}
const shapes = {
  declaration: (i, body) => [`export function h${i}(n: number) { return ${body("n")} }`, `h${i}(1)`],
  arrow: (i, body) => [`export const h${i} = (n: number) => ${body("n")}`, `h${i}(1)`],
  expression: (i, body) => [`export const h${i} = function (n: number) { return ${body("n")} }`, `h${i}(1)`],
  method: (i, body) => [`export const o${i} = { h(n: number) { return ${body("n")} } }`, `o${i}.h(1)`],
  static: (i, body) => [`export class C${i} { static h(n: number) { return ${body("n")} } }`, `C${i}.h(1)`],
  nested: (i, body) => [`export function h${i}(n: number) { const inner = (m: number) => ${body("m")}; return inner(n) }`, `h${i}(1)`],
}

function source(input) {
  const lines = ['import * as Schema from "effect/Schema"', 'import { Context, Layer, Stream } from "effect"',
    'export class Port extends Context.Service<Port, { readonly n: number }>()("Port") {}',
    'export class Failed extends Schema.TaggedError<Failed>()("Failed", { n: Schema.Number }) {}']
  input.forEach((h, i) => {
    const [definition, call] = shapes[h.shape](i, bodies[h.body])
    lines.push(definition, `export const v${i} = ${call}`)
  })
  return lines.join("\n") + "\n"
}

function declarationsOf(dir, file) {
  const program = ts.createProgram({ rootNames: [join(dir, file)], options: { ...ts.convertCompilerOptionsFromJson(options, dir).options, outDir: join(dir, "out") } })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")), [], "the TypeScript control must compile")
  program.emit()
  return readFileSync(join(dir, "out", file.replace(/\.ts$/, ".d.ts")), "utf8")
}

test("the plain-helper oracle quotes chapter 1", () => {
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes(quote))
})

test("plain helpers keep declarations under the tested compiler model", { skip }, async () => {
  const probeDir = mkdtempSync(join(tmpdir(), "plain-property-model-"))
  let flipped
  try { flipped = await toolchainKeepsFunctionsPlain({ compiler: native, modules, dir: probeDir }) } finally { rmSync(probeDir, { recursive: true, force: true }) }
  fc.assert(fc.property(fc.array(fc.record({ shape: fc.constantFrom(...Object.keys(shapes)), body: fc.constantFrom(...Object.keys(bodies)) }), { minLength: 1, maxLength: 3 }), (input) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-plain-property-"))
    try {
      symlinkSync(modules, join(root, "node_modules"))
      writeFileSync(join(root, "package.json"), '{"type":"module"}')
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, include: ["*.ts", "*.vibe"] }))
      writeFileSync(join(root, "m.ts"), source(input))
      const expected = declarationsOf(root, "m.ts")
      rmSync(join(root, "out"), { recursive: true, force: true })
      markPlainFunctions(ts, root, ["m.ts"], ["tsconfig.json"], { flipped })
      renameSync(join(root, "m.ts"), join(root, "m.vibe"))
      const output = execFileSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
      const marked = readFileSync(join(root, "m.vibe"), "utf8")
      assert.deepEqual(output.split("\n").filter((line) => /\): error /.test(line)), [], marked)
      assert.equal(canonicalize(ts, readFileSync(join(root, "out", "m.d.ts"), "utf8")), canonicalize(ts, expected), marked)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 1746, numRuns: 40 })
})

test("t3code schema helper: unmodified C1 fails, preserving plain passes with identical declarations", { skip }, async () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-pure-schema-factory.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "plain-schema-native-"))
  try {
    symlinkSync(modules, join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: options, include: ["*.ts", "*.vibe"] }))
    writeFileSync(join(root, "m.ts"), corpus.before)
    const expected = declarationsOf(root, "m.ts")
    rmSync(join(root, "out"), { recursive: true, force: true })
    const flipped = await toolchainKeepsFunctionsPlain({ compiler: native, modules, dir: join(root, "probe") })
    renameSync(join(root, "m.ts"), join(root, "m.vibe"))
    const before = spawnSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    console.log("SCHEMA_BEFORE_MODEL=" + (flipped ? "plain-by-syntax" : "legacy-inference") + " STATUS=" + before.status)
    if (flipped) assert.equal(before.status, 0, before.stdout + before.stderr)
    else { assert.notEqual(before.status, 0); assert.match(before.stdout + before.stderr, /Effect/) }
    renameSync(join(root, "m.vibe"), join(root, "m.ts"))
    markPlainFunctions(ts, root, ["m.ts"], ["tsconfig.json"], { flipped })
    renameSync(join(root, "m.ts"), join(root, "m.vibe"))
    execFileSync(native, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(canonicalize(ts, readFileSync(join(root, "out/m.d.ts"), "utf8")), canonicalize(ts, expected))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the same pass probes both actual native compiler models", { skip: skip || (!process.env.POST_FLIP_NATIVE && "set POST_FLIP_NATIVE") }, async () => {
  const root = mkdtempSync(join(tmpdir(), "plain-model-pair-"))
  try {
    assert.equal(await toolchainKeepsFunctionsPlain({ compiler: native, modules, dir: root }), false)
    assert.equal(await toolchainKeepsFunctionsPlain({ compiler: process.env.POST_FLIP_NATIVE, modules, dir: root }), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
