import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
const trace: string[] = []
function native(x: number | undefined = undefined): Generator<number,number|void> { if (x === undefined) { trace.push("sync-default"); return (function* () { return 7 })() }; return (function* () { trace.push("sync-body"); yield 0 })() }
function asyncNative(x: number | undefined = undefined): AsyncGenerator<number,number|void> { if (x === undefined) { trace.push("async-default"); return (async function* () { return 7 })() }; return (async function* () { trace.push("async-body"); yield 0 })() }
export function main() { return Effect.gen(function* () {
 const a = native(), b = asyncNative()
 const before = trace.slice()
 const first = a.next()
 const second = yield* Effect.promise(() => b.next())
 return { before, first, second, trace }
}) }
