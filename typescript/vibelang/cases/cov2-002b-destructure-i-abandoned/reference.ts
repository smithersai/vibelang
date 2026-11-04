import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
import { keys as corpusKeys, fixture, finish, attach, normalize } from "./fixture.js"
const keys=corpusKeys.filter(key=>["i-abandoned"].includes(key))
function k(xs: any, bad: {value: number}) { return Effect.gen(function* () { const [x = (yield* Effect.succeed(7), bad.value)] = xs; return x }) }
function h(xs: any, b: {value: number}) { return Effect.gen(function* () { let v: number; attach(xs, () => x); const [x = (v = b.value, yield* Effect.succeed(7), v)] = xs; return x }) }
function j(xs: any) { return Effect.gen(function* () { for (const value of xs) { return 9 }; return 9 }) }
function i(xs: any) { return Effect.gen(function* () { const [x = (yield* Effect.fail("f"), 1)] = xs; return 0 }) }
export function main() { return Effect.gen(function* () {
 const observations: unknown[] = []
 for (const key of keys) {
  const row = fixture(key)
  const result = yield* Effect.exit(row.method === "k" ? k(row.xs, row.b) : row.method === "h" ? h(row.xs, row.b) : row.method === "j" ? j(row.xs) : i(row.xs))
  finish(row)
  observations.push({ key, trace: row.trace, exit: normalize(result) })
 }
 return observations
}) }
