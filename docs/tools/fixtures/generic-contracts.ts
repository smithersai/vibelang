// Native TypeScript witness retained from before 66e1ff463707.
// VIP-4: written foreign contracts; this is not a VibeLang source-tag example.
import { Effect } from "effect"

/** @throws {"boom"} */
function keep<T>(value: T): T { throw "boom" }
function passEffect<T extends Effect.Effect<unknown>>(value: T): T { return value }
/** @throws {"default"} @rethrows f */
function invoke(f: () => number = () => { throw "default" }): number { return f() }
const constrainedContract = Effect.gen(function* () { return yield* passEffect(Effect.succeed(2)) })
const genericContract = Effect.gen(function* () {
  const e = yield* Effect.try({ try: () => keep(Effect.succeed(1)), catch: (error) => error })
  return yield* e
})
const omittedContract = Effect.try({ try: () => invoke(), catch: (error) => error })
const undefinedContract = Effect.try({ try: () => invoke(undefined), catch: (error) => error })
const suppliedContract = Effect.try({ try: () => invoke(() => 7), catch: (error) => error })
// genericContract fails with "boom"; omittedContract and undefinedContract fail with "default".
// constrainedContract succeeds with 2; suppliedContract succeeds with 7; its static own bound is deliberately conservative.
