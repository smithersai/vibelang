// Cost of operations on effect@4.1.0. Run: bun bench/perform.ts
// Prints nanoseconds per operation; numbers are indicative, not a benchmark suite.
import { Context, Effect } from "effect"
import { type Continuation, handle, operation, provideInPlace, resume } from "../../packages/runtime/src/kernel/kernel.ts"

class Counter extends Context.Service<Counter, { readonly next: (n: number) => Effect.Effect<number> }>()("bench/Counter") {}

const N = 200_000

const time = async (label: string, effect: Effect.Effect<unknown>) => {
  await Effect.runPromise(effect) // warm up
  const start = performance.now()
  await Effect.runPromise(effect)
  const ns = ((performance.now() - start) * 1e6) / N
  console.log(`${label.padEnd(58)} ${ns.toFixed(0).padStart(6)} ns/op`)
}

const loop = (step: (i: number) => Effect.Effect<number>) =>
  Effect.gen(function*() {
    let acc = 0
    for (let i = 0; i < N; i++) acc += yield* step(i)
    return acc
  })

// Wrap a step in `depth` extra compiled-function frames between perform and handler.
const nest = (depth: number, step: (i: number) => Effect.Effect<number>) => {
  let f = step
  for (let d = 0; d < depth; d++) {
    const inner = f
    f = Effect.fnUntraced(function*(i: number) {
      return yield* inner(i)
    })
  }
  return f
}

const Next = operation<number, number>("Next")

await time("plain Effect service call (yield* Counter; next)", loop((i) =>
  Effect.flatMap(Effect.service(Counter), (c) => c.next(i))
).pipe(Effect.provideService(Counter, { next: (n) => Effect.succeed(n + 1) })))

await time("kernel perform, in-place evidence", loop((i) => Next(i)).pipe(
  provideInPlace(Next, (n: number) => Effect.succeed(n + 1))
) as Effect.Effect<unknown>)

for (const depth of [0, 10, 100, 1000]) {
  await time(`control: in-place evidence under ${depth} compiled frames`, loop(nest(depth, (i) => Next(i))).pipe(
    provideInPlace(Next, (n: number) => Effect.succeed(n + 1))
  ) as Effect.Effect<unknown>)
  await time(`kernel perform, capture + resume, ${depth} frames in segment`, handle(
    "bench",
    [Next],
    loop(nest(depth, (i) => Next(i))),
    { Next: (n: number, k: Continuation) => resume(k, n + 1) }
  ))
}
