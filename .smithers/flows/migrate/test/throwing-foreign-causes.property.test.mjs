import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compareApiIdentity } from "../../../../scripts/api-identity.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformCausesOf, splitPlatformToModule, throwingCalleesOf, throwingCausesOf } from "../lib/platform.mjs"

// codemod-gap:effectful-factory-foreign-bridge: t3code's eager Effect factories
// (`export const program = () => Effect.succeed(foreign())`), listener
// registrations in a plain function returning an Effect and Error-valued
// mappers call TypeScript the compiler cannot prove non-throwing. Spec 003
// reports EK0401 there, `vibelang --fix` declines them (it bridges only a
// callback Effect runs in the fiber), and the module went back to TypeScript
// on every pass. The pass's EK0401 receipts name the callees; the next pass
// moves their declarations into `module throwing { }`, as it moves a `throw`,
// and the rest of the module migrates.

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const native = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? (existsSync(native) ? native : null)
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-effectful-factory-foreign-bridge.json", import.meta.url), "utf8"))
const file = corpus.file

test("the effectful-callable rule is quoted from the specification", () => {
  assert.ok(readFileSync(SpecPath("003-failures.md"), "utf8").includes(corpus.quote))
})

test("EK0401 messages name the callees whose throwing the compiler cannot rule out", () => {
  const messages = corpus.settleCauses[corpus.vibe].diagnostics.map((d) => d.message)
  assert.deepEqual(throwingCalleesOf(messages), corpus.names)
  assert.deepEqual(throwingCalleesOf(["error EK0401: 'parse' may throw 'SyntaxError', and synchronous VibeLang code never throws. Make the function 'effect'."]), ["parse"])
  // A throw statement, a host global and a type error name no callee.
  assert.deepEqual(throwingCalleesOf([
    "A 'throw' is not allowed outside effect code: synchronous VibeLang code never throws.",
    "process.env is platform code, which VibeLang code does not use directly.",
    "Type 'string' is not assignable to type 'number'."
  ]), [])
})

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "migrate-throwing-causes-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, dirname(file)), { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", private: true }))
  writeFileSync(join(root, file), corpus.source)
  writeFileSync(join(root, dirname(file), "foreign.d.ts"), corpus.foreign)
  const run = join(root, ".run")
  mkdirSync(run)
  writeFileSync(join(run, "settle-causes.json"), JSON.stringify(corpus.settleCauses))
  writeFileSync(join(run, "reverted.json"), JSON.stringify(corpus.reverted))
  return { root, run }
}

// reverted.json carries a module's first diagnostic only; settle-causes.json
// carries them all, so one pass moves every reported callee's declaration.
const expected = {
  "settle-causes.json": { names: corpus.names, moved: corpus.moved, throwing: corpus.throwing },
  "reverted.json": { names: ["foreign"], moved: ["Mapped", "mapper", "program"], throwing: ["mapper", "program"] }
}

for (const receipt of ["settle-causes.json", "reverted.json"]) {
  test(`${receipt} hands the module's EK0401 callees to the next pass, which moves their declarations into module throwing`, (t) => {
    const { root, run } = project(t)
    const config = { platformCauses: [receipt] }
    const throwsOf = throwingCausesOf(config, run)
    assert.deepEqual(throwsOf(file), expected[receipt].names)
    assert.deepEqual(throwsOf("src/other.ts"), [])
    // EK0401 names no host global, and without the receipts the split sees no throw.
    assert.deepEqual(platformCausesOf(config, run)(file), [])
    assert.deepEqual(prepareState(root, [file], [file], { ts }).platform.splits, [])
    const state = prepareState(root, [file], [file], { ts, throwsOf })
    assert.deepEqual(state.platform.refused, [])
    assert.equal(state.platform.splits.length, 1, JSON.stringify(state.platform))
    const [split] = state.platform.splits
    assert.equal(split.platform, null)
    assert.equal(split.module, "throwing")
    assert.deepEqual([...split.moved].sort(), expected[receipt].moved)
    assert.deepEqual([...split.throwing].sort(), expected[receipt].throwing)
    applyState(root, state)
    assert.ok(!existsSync(join(root, file)) && existsSync(join(root, corpus.vibe)))
    const module = readFileSync(join(root, corpus.vibe), "utf8")
    const { body, rest } = parts(module)
    assert.match(module, new RegExp(`^export \\{ ${expected[receipt].moved.join(", ")} \\} from throwing$`, "m"))
    assert.match(body, /Effect\.succeed\(foreign\(\)\)/, "the eager factory keeps its call")
    assert.match(body, /new Mapped\(\{ message: foreign\(\)/, "the mapper keeps its call")
    assert.doesNotMatch(rest, /export const program = /)
    assert.doesNotMatch(rest, /export function mapper\(/)
    // Plain code the compiler accepts stays: an async function rejects, a constant calls nothing.
    assert.match(rest, /^export async function later\(\) \{$/m)
    assert.match(rest, /^export const label = "session"$/m)
  })
}

// The `module throwing { }` block, and the module around it. TypeScript parses
// the block as a legacy namespace declaration, which ends where the body ends.
function parts(module) {
  const source = ts.createSourceFile("x.ts", module, ts.ScriptTarget.Latest, true)
  const block = source.statements.find((s) => ts.isModuleDeclaration(s) && s.name.text === "throwing")
  assert.ok(block, module)
  const start = block.getStart(source), end = block.end
  return { body: module.slice(start, end), rest: module.slice(0, start) + module.slice(end) }
}

function compileProject(dir, side, text, extension) {
  const root = join(dir, side)
  mkdirSync(join(root, "src"), { recursive: true })
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
  symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
  writeFileSync(join(root, "src/foreign.d.ts"), corpus.foreign)
  writeFileSync(join(root, "src/sessionState." + extension), text)
  const r = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 180_000 })
  return { root, status: r.status, output: r.stdout + r.stderr }
}

test("the moved factories compile as a module body, keep their calls and declare what the TypeScript module declares", { skip: !compiler && "no compiler binary" }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "throwing-causes-compile-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const original = compileProject(dir, "ts", corpus.source, "ts")
  assert.equal(original.status, 0, original.output)
  // Renamed as is, the module reports the calls the receipts name.
  const renamed = compileProject(dir, "renamed", corpus.source, "vibe")
  assert.notEqual(renamed.status, 0)
  assert.match(renamed.output, /EK0401: 'foreign' may throw/)
  assert.match(renamed.output, /EK0401: 'nativeTheme\.on' may throw/)
  const split = splitPlatformToModule(corpus.source, file, ts, { throws: true, throwing: corpus.names })
  const vibe = compileProject(dir, "vibe", split.module, "vibe")
  assert.equal(vibe.status, 0, vibe.output + "\n" + split.module)
  assert.doesNotMatch(vibe.output, /EK0401/)
  assert.match(readFileSync(join(vibe.root, "out/sessionState.d.ts"), "utf8"), /export \{ Mapped, mapper, program, watch \} from "\.\/sessionState\.vibe\.throwing\.js"/)
  assert.ok(existsSync(join(vibe.root, "out/sessionState.vibe.throwing.d.ts")))
  for (const root of [original.root, vibe.root]) writeFileSync(join(root, "out/package.json"), '{"types":"sessionState.d.ts"}')
  const api = compareApiIdentity(ts, join(original.root, "out"), join(vibe.root, "out"), { compilerOptions: { types: [] } })
  assert.ok(api.comparisonComplete && api.identical, JSON.stringify(api) + "\n" + split.module)
})

// Neighbourhood: the callee's spelling, the factory's form, its export, what
// it reads, an Error-valued mapper and plain code the compiler accepts.
const callees = {
  foreign: { declare: "export declare function foreign(): string;", call: "foreign()" },
  "nativeTheme.on": { declare: "export declare const nativeTheme: { on(event: string, listener: () => void): void };", call: 'nativeTheme.on("updated", () => {})' },
  "host.events.emit": { declare: "export declare const host: { events: { emit(name: string): number } };", call: 'host.events.emit("ready")' }
}
const shapes = fc.record({
  callee: fc.constantFrom(...Object.keys(callees)), factory: fc.constantFrom("arrow", "block", "declaration"),
  exported: fc.boolean(), reads: fc.boolean(), mapper: fc.boolean(), asyncCaller: fc.boolean(), spaced: fc.boolean()
})
const moduleOf = (s) => {
  const c = callees[s.callee]
  const call = s.spaced ? c.call.replace(/\(/, " (") : c.call
  const value = s.reads ? `[${call}, suffix]` : call
  const head = s.exported ? "export " : ""
  const factory = s.factory === "arrow" ? `${head}const program = () => Effect.succeed(${value})`
    : s.factory === "block" ? `${head}const program = () => {\n  const value = ${value}\n  return Effect.succeed(value)\n}`
    : `${head}function program() {\n  return Effect.succeed(${value})\n}`
  return [
    'import * as Effect from "effect/Effect"',
    `import { ${s.callee.split(".")[0]} } from "./foreign.js"`,
    s.reads ? 'const suffix = "!"' : "",
    factory,
    s.mapper ? `export const mapper = () => (cause: unknown) => Effect.fail(String(cause) + String(${call}))` : "",
    s.asyncCaller ? `export async function later() {\n  return ${call}\n}` : "",
    'export const label = "module"'
  ].filter(Boolean).join("\n") + "\n"
}

test("every declaration that calls a reported callee in plain code moves, and the module compiles", () => checkProperty(fc, {
  name: corpus.key, rule: corpus.quote, command: "node --test .smithers/flows/migrate/test/throwing-foreign-causes.property.test.mjs",
  regressions: new URL("./corpus/", import.meta.url), numRuns: compiler ? 12 : 60,
  arbitrary: shapes,
  check: (shape) => {
    const text = moduleOf(shape)
    const unaware = splitPlatformToModule(text, "src/x.ts", ts, { throws: true })
    assert.equal(unaware, null, "no throw statement: nothing moves without the receipts")
    const split = splitPlatformToModule(text, "src/x.ts", ts, { throws: true, throwing: [shape.callee] })
    assert.ok(split?.module, JSON.stringify(split))
    assert.equal(split.name, "throwing")
    const moved = ["program", ...(shape.reads ? ["suffix"] : []), ...(shape.mapper ? ["mapper"] : [])].sort()
    assert.deepEqual([...split.moved].sort(), moved, split.module)
    assert.deepEqual([...split.throwing].sort(), moved.filter((n) => n !== "suffix"), split.module)
    const { rest } = parts(split.module)
    if (shape.asyncCaller) assert.match(rest, /^export async function later\(\) \{$/m, "an async caller stays: its call rejects")
    assert.match(rest, /^export const label = "module"$/m)
    const exported = [...(shape.exported ? ["program"] : []), ...(shape.mapper ? ["mapper"] : [])].sort()
    if (exported.length) assert.match(rest, new RegExp(`^export \\{ ${exported.join(", ")} \\} from throwing$`, "m"))
    else assert.doesNotMatch(rest, /from throwing$/m)
    if (!compiler) return
    const dir = mkdtempSync(join(tmpdir(), "throwing-causes-property-"))
    try {
      const foreign = { ...corpus, foreign: callees[shape.callee].declare + "\n" }
      const write = (side, body, extension) => {
        const root = join(dir, side)
        mkdirSync(join(root, "src"), { recursive: true })
        writeFileSync(join(root, "package.json"), '{"type":"module"}')
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
        symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
        writeFileSync(join(root, "src/foreign.d.ts"), foreign.foreign)
        writeFileSync(join(root, "src/x." + extension), body)
        const r = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 180_000 })
        return { root, status: r.status, output: r.stdout + r.stderr }
      }
      const original = write("ts", text, "ts")
      assert.equal(original.status, 0, original.output)
      const renamed = write("renamed", text, "vibe")
      assert.notEqual(renamed.status, 0, "the renamed module reports the call")
      assert.match(renamed.output, new RegExp(`EK0401: '${shape.callee.replace(/\./g, "\\.")}' may throw`))
      const vibe = write("vibe", split.module, "vibe")
      assert.equal(vibe.status, 0, vibe.output + "\n" + split.module)
      for (const root of [original.root, vibe.root]) writeFileSync(join(root, "out/package.json"), '{"types":"x.d.ts"}')
      const api = compareApiIdentity(ts, join(original.root, "out"), join(vibe.root, "out"), { compilerOptions: { types: [] } })
      assert.ok(api.comparisonComplete && api.identical, JSON.stringify(api) + "\n" + split.module)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}))
