// Native TypeScript witness retained from chapter 003 before 66e1ff463707.
// Authority: current VIP-4/VIP-5 native exception and execution boundaries.
import { Effect } from "effect"

function defaultError(): never { throw "default" }
function defaultKey(): never { throw "key" }
const defaultedHandler = Effect.catch(Effect.fail(undefined),
  (e: unknown = defaultError()) => Effect.succeed(7))
const expressionHandler = Effect.catch(Effect.fail(undefined),
  function (e: unknown = defaultError()) { return Effect.succeed(7) })
const computedHandler = Effect.catch(Effect.fail({}),
  ({ [defaultKey()]: value }: any) => Effect.succeed(7))
const implicitHandler = Effect.catch(Effect.fail(null as any),
  ({ value }: { value: number }) => Effect.succeed(value))
const lazyHandler = Effect.catch(Effect.fail(undefined),
  (e: unknown = () => defaultError()) => Effect.succeed(7))
const bridgedHandler = Effect.catch(Effect.fail(undefined), input => Effect.gen(function* () {
  if (input === undefined) yield* Effect.try({ try: () => defaultError(), catch: error => error })
  return 7
}))
// Defaults and computed keys above Die("default") / Die("key"); implicitHandler dies with TypeError.
// lazyHandler succeeds with 7; bridgedHandler fails with "default".
