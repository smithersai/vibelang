import { Effect } from "effect"
const promise = Promise.resolve(7)
let calls = 0
const thenable = { then(resolve: (value: number) => void) { calls++; resolve(8) } }
const unknownThenable: unknown = thenable
function returned() { return Effect.gen(function* () { return thenable }) }
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  const fromTry = yield* Effect.succeed(promise)
  const fromThenable = yield* Effect.succeed(thenable)
  const fromReturn = yield* returned()
  const fromHandler = yield* Effect.catch(Effect.fail("x"), () => Effect.succeed(unknownThenable))
  return [fromTry === promise, fromThenable === thenable, fromReturn === thenable, fromHandler === thenable, calls]
}) }
