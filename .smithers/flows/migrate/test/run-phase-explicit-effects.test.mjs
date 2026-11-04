import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { runPhaseChanges, vibeTree } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-explicit-effects-run-phase.json", import.meta.url), "utf8"))
const changes = (before, after) => runPhaseChanges({ ts, original: before, originalPath: "main.ts", vibe: vibeTree(compiler, after, "main.vibe"), vibeText: after })
  .map(({ name, verdict }) => ({ name, verdict }))

test("explicit-effects run-phase corpus quotes the function-kind contract", () => {
  const chapter = readFileSync(SpecPath("001-functions.md"), "utf8")
  assert.ok(chapter.includes(corpus.quote))
  assert.ok(chapter.includes(corpus.equivalenceQuote))
})
for (const sample of corpus.samples) {
  test("t3code run-phase: " + sample.key, native, () => {
    assert.deepEqual(changes(sample.before, sample.after), sample.expected)
  })
}

test("callbacks keep their ordinal when only a later callback changes kind", native, () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function suite(it) { it.effect("first", () => Effect.gen(function* () {})); it.effect("second", () => 42); }',
    'export function suite(it) { it.effect("first", () => effect {}); it.effect("second", effect () => {}); }'),
  [{ name: "suite/it.effect(1)#1", verdict: "value" }])
})

test("effect blocks retain nested callback attribution", native, () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function make() { return Effect.gen(function* () { register(() => 42); }); }',
    'export function make() { return effect { register(effect () => {}); }; }'),
  [{ name: "make/register(0)", verdict: "value" }])
})

test("casts around callbacks preserve attribution", native, () => {
  assert.deepEqual(changes(
    'export function suite(it) { it.effect("value", ((() => 42) as any)); }',
    'export function suite(it) { it.effect("value", ((effect () => {}) as any)); }'),
  [{ name: "suite/it.effect(1)", verdict: "value" }])
})

// The quoted VIP-1 rule and its effect-arrow equivalence table are the oracle.
// Vary callback nesting, repeated callees, argument indices and void spelling;
// replacing a plain value with a program must still be rejected.
test("explicit-effects callbacks preserve void completions and isolate real value drops", native, () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 3 }),
    fc.constantFrom("", "return;", "return undefined;"), fc.boolean(), fc.boolean(),
    (count, depth, completion, drop, extraArgument) => {
      const prefix = extraArgument ? '0, "case", ' : '"case", '
      const beforeCallbacks = Array.from({ length: count }, (_, i) =>
        'it.effect(' + prefix + '() => Effect.gen(function* () { yield* task(); ' +
        (drop && i === count - 1 ? "return 42;" : completion) + ' }));').join(" ")
      const afterCallbacks = Array.from({ length: count }, () =>
        'it.effect(' + prefix + 'effect () => { try task(); ' + completion + ' });').join(" ")
      const nest = text => Array.from({ length: depth }).reduce(text => 'describe("suite", () => { ' + text + ' });', text)
      const before = 'import { Effect } from "effect"; export function suite(it) { ' + nest(beforeCallbacks) + ' }'
      const after = 'export function suite(it) { ' + nest(afterCallbacks) + ' }'
      const result = changes(before, after)
      if (!drop) assert.deepEqual(result, [])
      else {
        assert.equal(result.length, 1)
        assert.equal(result[0].verdict, "value")
        assert.match(result[0].name, /it\.effect\(/)
      }
    }), { seed: 7007375, numRuns: 100 })
})

test("constructing an unused program at the call remains eager", native, () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function f() { const unused = Effect.gen(function* () { return 42; }); return Effect.gen(function* () {}); }',
    'export effect function f() { const unused = effect { return 42; }; }'),
  [{ name: "f", verdict: "eager" }])
})

test("nested callback returns do not replace an effect body return", native, () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export const f = () => Effect.gen(function* () { return 42; });',
    'export const f = effect () => { const later = () => 42; };'),
  [{ name: "f", verdict: "value" }])
})

test("bodyless overload signatures keep the existing run-phase behavior", native, () => {
  assert.deepEqual(changes(
    'import { Effect } from "effect"; export function f(x: number): Effect.Effect<number>; export function f(x: number) { return Effect.gen(function* () { return x; }); }',
    'export effect function f(x: number) { return x; }'), [])
})
