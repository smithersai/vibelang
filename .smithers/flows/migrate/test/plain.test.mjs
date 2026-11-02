import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { markPlainFunctions, toolchainKeepsFunctionsPlain } from "../lib/plain.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const tsconfig = JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true } })

/** Marks one module, src/m.ts, in a project that resolves effect, and returns its text and the result. */
export function mark(text) {
  const root = mkdtempSync(join(tmpdir(), "migrate-plain-"))
  try {
    symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), tsconfig)
    writeFileSync(join(root, "m.ts"), text)
    const result = markPlainFunctions(ts, root, ["m.ts"], ["tsconfig.json"])
    return { text: readFileSync(join(root, "m.ts"), "utf8"), result: result["m.ts"] }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// t3code's contracts: an unannotated schema factory compiled as an Effect
// function, so `ThreadId = makeEntityId("ThreadId")` was EK1001 and every
// importer read Effect<Schema> (drive-t3code 17:46Z, 14 modules of batch 01).
test("t3code: a schema factory keeps TypeScript's plain return type", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-pure-schema-factory.json", import.meta.url), "utf8"))
  assert.equal(mark(corpus.before).text, corpus.after, corpus.key)
})

test("every function TypeScript calls for its result gets `: infer _`, a bare arrow parameter its parentheses", () => {
  const { text, result } = mark([
    "export function twice(n: number) { return n * 2 }",
    "export const inc = (n: number) => n + 1",
    "export const neg = n => -n",
    "export const f = function (n: number) { return n }",
    "export const o = { m(n: number) { return n }, a: (n: number) => n }",
    "export class K { m() { return 1 } static make() { return new K() } get size() { return 1 } }",
    "export function outer(n: number) { const inner = (m: number) => m + n; return inner(1) }",
    ""
  ].join("\n"))
  assert.equal(text, [
    "export function twice(n: number): infer _ { return n * 2 }",
    "export const inc = (n: number): infer _ => n + 1",
    "export const neg = (n): infer _ => -n",
    "export const f = function (n: number): infer _ { return n }",
    "export const o = { m(n: number): infer _ { return n }, a: (n: number): infer _ => n }",
    "export class K { m(): infer _ { return 1 } static make(): infer _ { return new K() } get size() { return 1 } }",
    "export function outer(n: number): infer _ { const inner = (m: number): infer _ => m + n; return inner(1) }",
    ""
  ].join("\n"))
  assert.equal(result.marked, 10)
})

test("callbacks, async and annotated functions, and functions that return a program stay as written", () => {
  const source = [
    'import { Effect } from "effect"',
    "export const xs = [1, 2].map((n) => n + 1).filter(function (n) { return n > 1 })",
    "export const later = async (n: number) => n",
    "export const typed = (n: number): number => n",
    "export const load = (id: string) => Effect.succeed(id)",
    "export function gen() { return Effect.gen(function* () { return 1 }) }",
    "export const maybe = (id: string) => (id ? Effect.succeed(id) : undefined)",
    ""
  ].join("\n")
  const { text, result } = mark(source)
  assert.equal(text, source)
  assert.equal(result, undefined)
})

// A Layer or a Stream is a description, as a schema is: unannotated, `layer`
// declared Effect<Layer<Port>> and `live = layer(1)` was EK1001.
test("a function that builds a Layer or a Stream keeps TypeScript's plain return type", () => {
  const { text, result } = mark([
    'import { Context, Layer, Stream } from "effect"',
    "class Port extends Context.Service<Port, { readonly n: number }>()(\"Port\") {}",
    "export const layer = (n: number) => Layer.succeed(Port, { n })",
    "export const stream = () => Stream.make(1, 2)",
    "export const live = layer(1)",
    ""
  ].join("\n"))
  assert.match(text, /export const layer = \(n: number\): infer _ => Layer\.succeed/)
  assert.match(text, /export const stream = \(\): infer _ => Stream\.make/)
  assert.equal(result.marked, 2)
})

// t3code vcs.ts (drive-t3code 19:07Z, 19:44Z): a static factory returns a
// Schema.TaggedError instance, which carries the Effect brand. Unannotated it
// returned Effect<VcsProcessExitError>, so `yield* VcsProcessExitError.fromProcessExit(…)`
// succeeded with the error instead of failing, and a TypeScript caller read `_tag` as undefined.
test("corpus: a static factory that returns a tagged error stays plain (t3code vcs.ts)", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-plain-static-error-factory.json", import.meta.url), "utf8"))
  assert.equal(mark(corpus.before).text, corpus.after, corpus.key)
})

test("a plain generator gets its Generator type written, as infer _ names none", () => {
  const { text } = mark("export function* ids() { yield 1; yield 2 }\n")
  assert.equal(text, "export function* ids(): Generator<1 | 2, void, unknown> { yield 1; yield 2 }\n")
})
// t3code apps/web state/query.ts (drive-t3code-apps 01:04Z): Atom.make has
// an overload whose reader returns an Effect, and the toolchain picked it for
// the unannotated callback, so the export's type gained AsyncResult.
test("corpus: a reader callback of an overloaded callee stays plain (t3code Atom.make)", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-atom-reader-callback-kind.json", import.meta.url), "utf8"))
  assert.equal(mark(corpus.before).text, corpus.after, corpus.key)
})

// The drive's neighbourhood (20 seeded witnesses): reader and source names,
// import aliases, dot or index access, predicates and initial states.
test("property: every reader of an overloaded Atom.make keeps TypeScript's plain return", () => {
  const fc = createRequire(join(runtime, "package.json"))("fast-check")
  const name = fc.constantFrom("get", "read", "ctx")
  fc.assert(fc.property(fc.record({ reader: name, atom: fc.constantFrom("Atom", "A"), result: fc.constantFrom("AsyncResult", "R"), index: fc.boolean(), initial: fc.boolean(), negate: fc.boolean() }), (input) => {
    const imports = `import { ${input.atom === "Atom" ? "Atom" : "Atom as A"}, ${input.result === "AsyncResult" ? "AsyncResult" : "AsyncResult as R"} } from "effect/reactivity"`
    const tag = input.index ? `${input.reader}(source)["_tag"]` : `${input.reader}(source)._tag`
    const body = `${input.negate ? "!(" : ""}${tag} === "${input.initial ? "Initial" : "Success"}"${input.negate ? ")" : ""}`
    const source = `${imports}\nconst source = ${input.atom}.make(${input.result}.initial<never, never>(false))\nexport const derived = ${input.atom}.make((${input.reader}) => ${body})\n`
    assert.equal(mark(source).text, source.replace(`.make((${input.reader}) =>`, `.make((${input.reader}): infer _ =>`), source)
  }), { numRuns: 24 })
})

test("callbacks of one signature, or whose chosen overload takes an Effect, stay as written", () => {
  const source = [
    'import { Effect } from "effect"',
    "export const xs = [1, 2].map((x) => x + 1)",
    "export const mapped = Effect.map(Effect.succeed(1), (x) => x + 1)",
    "export const chained = Effect.flatMap(Effect.succeed(1), (x) => Effect.succeed(x + 1))",
    ""
  ].join("\n")
  assert.equal(mark(source).text, source)
})

// Decided detail 269: after VIP-1's flip `: infer _` means nothing and
// TypeScript rejects it, so on a flipped toolchain the pass writes none; a
// plain generator still gets its written Generator type.
test("on a toolchain that keeps functions plain, the pass writes no infer _", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-plain-flipped-"))
  try {
    symlinkSync(join(runtime, "node_modules"), join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), tsconfig)
    const source = "export const inc = (n: number) => n + 1\nexport function* ids() { yield 1 }\n"
    writeFileSync(join(root, "m.ts"), source)
    markPlainFunctions(ts, root, ["m.ts"], ["tsconfig.json"], { flipped: true })
    assert.equal(readFileSync(join(root, "m.ts"), "utf8"), source.replace("function* ids()", "function* ids(): Generator<number, void, unknown>"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the toolchain probe tells a flipped compiler from one before the flip", async () => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-plain-probe-"))
  try {
    const fake = (declared) => {
      const compiler = join(dir, `vibelang-${declared.length}`)
      writeFileSync(compiler, `#!/bin/sh\nmkdir -p out && printf '%s\\n' ${JSON.stringify(declared)} > out/probe.d.ts\n`, { mode: 0o755 })
      return compiler
    }
    const modules = join(runtime, "node_modules")
    assert.equal(await toolchainKeepsFunctionsPlain({ compiler: fake("export declare const f: () => number;"), modules, dir }), true)
    assert.equal(await toolchainKeepsFunctionsPlain({ compiler: fake("export declare const f: () => Effect.Effect<number, never, never>;"), modules, dir }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})


test("a failed or unknown function-model probe refuses before rewriting sources and cleans its scratch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-plain-probe-failure-"))
  try {
    const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-function-model-probe-failure.json", import.meta.url), "utf8"))
    for (const { body, diagnostic } of corpus.cases) {
      const compiler = join(dir, "vibelang")
      writeFileSync(compiler, "#!/bin/sh\n" + body + "\n", { mode: 0o755 })
      await assert.rejects(toolchainKeepsFunctionsPlain({ compiler, modules: join(runtime, "node_modules"), dir }), new RegExp(diagnostic))
      assert.deepEqual(readdirSync(dir), ["vibelang"])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("property: the function-model probe accepts only successful recognized declarations", async () => {
  const fc = createRequire(join(runtime, "package.json"))("fast-check")
  const dir = mkdtempSync(join(tmpdir(), "migrate-probe-generated-"))
  const plain = "export declare const f: () => number;"
  const legacy = "export declare const f: () => Effect.Effect<number, never, never>;"
  try {
    await fc.assert(fc.asyncProperty(fc.record({
      exit: fc.integer({ min: 0, max: 5 }),
      declared: fc.constantFrom(null, plain, legacy, "export declare const f: () => string;"),
      output: fc.string({ minLength: 1, maxLength: 80 })
    }), async (input) => {
      const compiler = join(dir, "vibelang")
      writeFileSync(compiler, "#!/usr/bin/env node\nconst fs=process.getBuiltinModule('fs');fs.mkdirSync('out',{recursive:true});" +
        (input.declared === null ? "" : "fs.writeFileSync('out/probe.d.ts'," + JSON.stringify(input.declared) + ");") +
        "process.stderr.write(" + JSON.stringify(input.output) + ");process.exit(" + input.exit + ");", { mode: 0o755 })
      const probe = () => toolchainKeepsFunctionsPlain({ compiler, modules: join(runtime, "node_modules"), dir })
      if (input.exit === 0 && [plain, legacy].includes(input.declared)) {
        assert.equal(await probe(), input.declared === plain)
      } else {
        await assert.rejects(probe(), /function-model probe (failed|emitted)/)
      }
      assert.deepEqual(readdirSync(dir), ["vibelang"])
    }), { numRuns: 100, seed: 441902 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
