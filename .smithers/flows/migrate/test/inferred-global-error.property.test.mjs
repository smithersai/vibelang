import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { parseStyleTree, preservedGlobalErrors } from "../lib/preserved-errors.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-node-inferred-global-error.json", import.meta.url), "utf8"))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }

/** One advisory at each occurrence of `marker`, where the compiler reports them. */
const advisories = (source, marker = "new Error") => {
  const found = []
  for (let offset = source.indexOf(marker); offset >= 0; offset = source.indexOf(marker, offset + 1)) {
    const prefix = source.slice(0, offset).split("\n")
    found.push({ file: "main.vibe", line: prefix.length, column: prefix.at(-1).length + 1, category: "warning", code: "EK4804", message: "This failure is a global Error, which has no _tag for a catch or a match to tell it apart by.", notes: [] })
  }
  return found
}
const decide = async (before, after, ds = advisories(after)) =>
  preservedGlobalErrors(await parseStyleTree(compiler, "main.ts", before), await parseStyleTree(compiler, "main.vibe", after), after, ds)

test("foldkit-29: packages/node's private inferred channels keep their advisories", native, async () => {
  const ds = corpus.markers.flatMap(marker => advisories(corpus.after, marker))
  const result = await decide(corpus.before, corpus.after, ds)
  assert.equal(ds.length, corpus.markers.length)
  assert.deepEqual(result.decisions.filter(d => !d.exempt), [])
  assert.equal(result.accepted.size, ds.length)
})

const message = fc.constantFrom('"bad"', "MESSAGE", '"bad", { cause }', "`bad ${cause}`")
const originalForms = {
  fail: m => `Effect.fail(new Error(${m}))`,
  gen: m => `Effect.gen(function* () { return yield* Effect.fail(new Error(${m})) })`,
  try: m => `Effect.try({ try: () => 1, catch: () => new Error(${m}) })`,
  tryPromise: m => `Effect.tryPromise({ try: () => run(), catch: () => { return new Error(${m}) } })`,
  mapError: m => `Effect.mapError(work(), () => new Error(${m}))`,
  pipe: m => `work().pipe(Effect.mapError(() => new Error(${m})))`,
}
const head = "import { Effect } from 'effect'\nconst MESSAGE = 'bad'\nconst cause = 1\n"

test("the same new Error in the same function is preserved, whichever failure form the original wrote", native, async () => {
  // Foldkit ruling 18:45Z: "preserving a published Error contract is required, so the flow must not reject it."
  await fc.assert(fc.asyncProperty(message, fc.constantFrom(...Object.keys(originalForms)), fc.constantFrom("const", "function"), async (m, form, shape) => {
    const before = head + `const load = () => ${originalForms[form](m)}\nexport const work = load\n`
    const after = shape === "const"
      ? `const MESSAGE = "bad"\nconst cause = 1\nconst load = effect () => { throw new Error(${m}) }\nexport const work = load\n`
      : `const MESSAGE = "bad"\nconst cause = 1\neffect function load() { throw new Error(${m}) }\nexport const work = load\n`
    assert.equal((await decide(before, after)).accepted.size, 1, after)
  }), { seed: 290030, numRuns: 80 })
})

test("a global Error the original function did not fail with stays rejected", native, async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom(...Object.keys(originalForms)), async form => {
    const original = originalForms[form]('"bad"')
    const rejected = [
      // another message
      [`const load = () => ${original}`, 'const load = effect () => { throw new Error("other") }'],
      // another function
      [`const other = () => ${original}`, 'const load = effect () => { throw new Error("bad") }'],
      // one failure in the original, two now
      [`const load = () => ${original}`, 'const load = effect (a: boolean) => { if (a) { throw new Error("bad") } throw new Error("bad") }'],
      // a written channel that drops Error
      [`const load = () => ${original}`, 'error Tagged {}\nconst load = effect (): number!Tagged => { throw new Error("bad") }'],
      // a shadowed Error is someone else's class
      [`class Error {}\nconst load = () => ${original}`, 'const load = effect () => { throw new Error("bad") }'],
      [`const load = () => ${original}`, 'class Error {}\nconst load = effect () => { throw new Error("bad") }'],
    ]
    for (const [before, after] of rejected) {
      const ds = advisories(after)
      const result = await decide(head + before, after, ds)
      // The two-failure case keeps its one matching advisory and rejects the other.
      assert.equal(result.accepted.size, after.includes("if (a)") ? 1 : 0, before + "\n=> " + after)
    }
  }), { seed: 290031, numRuns: 12 })
})

test("an Error that was never a failure in the original proves nothing", native, async () => {
  for (const before of [
    'const load = () => { const e = new Error("bad"); return Effect.succeed(e) }',
    'const load = () => Effect.gen(function* () { throw new Error("bad") })',
    'const load = () => Effect.sync(() => new Error("bad"))',
    'const load = () => Effect.try({ try: () => { throw new Error("bad") }, catch: toError })',
    'const Fake = { fail: (e: Error) => e }\nconst load = () => Fake.fail(new Error("bad"))',
  ]) {
    const after = 'const load = effect () => { throw new Error("bad") }'
    assert.equal((await decide(head + before, after)).accepted.size, 0, before)
  }
})

test("an advisory is tied to its own expression, never a later one", native, async () => {
  const before = head + 'const load = () => Effect.fail(new Error("bad"))\n'
  const after = 'const toError = (cause: unknown) => cause as Error\nconst load = effect () => { const a = Effect.try({ try: () => 1, catch: toError }); throw new Error("bad") }\n'
  const [d] = advisories(after, "catch: toError")
  assert.equal((await decide(before, after, [d])).accepted.size, 0)
})

test("the message decides: a changed cause keeps the proof, a changed message loses it", native, async () => {
  const before = head + 'const read = (p: string) => Effect.tryPromise({ try: () => run(), catch: cause => new Error(`could not read ${p}`, { cause }) })\n'
  const native = message => `const read = effect (p: string) => { throw new Error(${message}) }\n`
  assert.equal((await decide(before, native("`could not read ${p}`, { cause: 1 }"))).accepted.size, 1)
  assert.equal((await decide(before, native("`could not read ${p}`"))).accepted.size, 1)
  assert.equal((await decide(before, native("`could not load ${p}`, { cause: 1 }"))).accepted.size, 0)
})
