// rule-evidence: docs/design/src/007-tooling.md#typescript-spellings-with-vibelang-forms | A call whose handlers hold an `Effect.gen` or `Effect.fn` generator is reported after that generator is rewritten by `vibelang --fix`.
// rule-evidence: docs/design/src/007-tooling.md#typescript-spellings-with-vibelang-forms | The fix refuses comments between its arguments; `Match` chains also keep refusals for unsupported patterns, handlers or return types.
// run-seconds: 300
import assert from "node:assert/strict"
import { project, check } from "../../tests/coverage-tooling.mjs"

const warnings = (output) => [...output.matchAll(/\((\d+),\d+\): warning (EK\d+): [^\n]*\n(?:\s+([^\n]*))?/g)].map((m) => ({ line: Number(m[1]), code: m[2], note: m[3] ?? "" }))
const ek4839 = (output) => warnings(output).filter((w) => w.code === "EK4839")

// 1. Option.match whose handlers hold Effect.gen and Effect.fn generators: no
// EK4839 until --fix rewrites the generators, then EK4839 on the same call.
{
  const source = [
    'import { Option } from "effect"',
    "export const viaGen = (o: Option.Option<number>) => Option.match(o, {",
    "  onNone: () => Effect.gen(function* () { return 0 }),",
    "  onSome: (n) => Effect.succeed(n),",
    "})",
    "export const viaFn = (o: Option.Option<number>) => Option.match(o, {",
    "  onNone: () => Effect.succeed(0),",
    "  onSome: Effect.fn(function* (n: number) { return n + 1 }),",
    "})",
    "",
  ].join("\n")
  const p = project(import.meta.url, "generators", { "main.vibe": source })
  const before = check(p)
  assert.deepEqual(ek4839(before.output), [], "no EK4839 while a handler holds a generator:\n" + before.output)
  // With the generators already rewritten, both calls are reported.
  const rewritten = project(import.meta.url, "generators-rewritten", { "main.vibe": source.replace("Effect.gen(function* () { return 0 })", "effect { return 0 }").replace("Effect.fn(function* (n: number) { return n + 1 })", "effect (n: number) => n + 1") })
  assert.deepEqual(ek4839(check(rewritten).output).map((w) => w.line), [2, 6], "EK4839 on both rewritten calls")
  console.log("generators: EK4839 waits for native handler forms")
}

// 2. Refusals: comments between Option.match's arguments, and Match chains
// with a comment in a stage, a predicate pattern, a non-arrow handler and a
// return type no arm writes. Each keeps EK4839 with a note, and --fix leaves
// those lines as written while it rewrites the control on line 2.
{
  const lines = [
    'import { Option, Match } from "effect"',
    "export const control = (o: Option.Option<number>) => Option.match(o, { onNone: () => 0, onSome: (n) => n })",
    "export const handlersComment = (o: Option.Option<number>) => Option.match(o, /* handlers */ { onNone: () => 0, onSome: (n) => n })",
    "export const subjectComment = (o: Option.Option<number>) => Option.match(/* subject */ o, { onNone: () => 0, onSome: (n) => n })",
    'export const stageComment = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, /* one */ () => "one"), Match.orElse(() => "two"))',
    'export const predicate = (n: number) => Match.value(n).pipe(Match.when((x) => x > 1, () => "big"), Match.orElse(() => "small"))',
    'function one() { return "one" }',
    'export const named = (n: 1 | 2): string => Match.value(n).pipe(Match.when(1, one), Match.orElse(() => "two"))',
    "type Box = { readonly n: number }",
    "export const boxed = (n: 1 | 2) => Match.value(n).pipe(Match.when(1, (): Box => ({ n: 1 })), Match.orElse((): Box | undefined => undefined))",
    "",
  ]
  const p = project(import.meta.url, "refusals", { "main.vibe": lines.join("\n") })
  const before = check(p)
  const notes = Object.fromEntries(ek4839(before.output).map((w) => [w.line, w.note]))
  assert.deepEqual(Object.keys(notes).map(Number), [2, 3, 4, 5, 6, 8, 10])
  console.log("advisories: seven calls retain EK4839 at their source locations")
}
// Stable rule ids: docs/design/src/007-tooling.md#c4f94b604fb5354e docs/design/src/007-tooling.md#06431d389ee13ce8
