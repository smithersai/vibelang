// Native TypeScript witness retained from chapter 003 before 66e1ff463707.
// Authority: current VIP-4/VIP-5 native exception and execution boundaries.
import { Effect } from "effect"

function* lazy() { throw "body" }
function failDefault() { throw "default" }
function* eager(x = failDefault()) { yield x }
const constructed = Effect.gen(function* () {
  lazy()
  return "not started"
})
const resumed = Effect.try({ try: () => lazy().next(), catch: (error) => error })
const defaulted = Effect.try({ try: () => eager(), catch: (error) => error })
async function* asyncLazy() { throw "async body" }
async function* asyncEager(x = failDefault()) { yield x }
const resumedAsync = Effect.tryPromise({ try: () => asyncLazy().next(), catch: (error) => error })
const defaultedAsync = Effect.try({ try: () => asyncEager(), catch: (error) => error })
// resumedAsync fails with "async body"; defaultedAsync fails with "default".
// constructed succeeds with "not started"; resumed fails with "body"; defaulted fails with "default".
