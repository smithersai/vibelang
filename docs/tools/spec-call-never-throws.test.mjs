import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// Loop round 1, OPUS-3: chapter 1's counterpart table writes parameter
// binding before Effect.gen, which would throw at the call; chapter 3 and
// VIP-2 say the call never throws. Chapter 1 now states the rule beside it.
test("chapter 1 says a call whose binding throws returns a dying Effect", () => {
  assert.match(chapter("001-functions"), /If binding throws, as destructuring `undefined` does, the call returns an Effect that dies with the thrown value, as an `async` function's call returns a rejected Promise, and a producer's call returns a Stream that dies with it; the call itself never throws/)
  assert.match(chapter("003-failures"), /The call itself never throws/)
})

// The model the sentence follows: an async function's binding failure is a
// rejection of the Promise its call returns, never a synchronous throw.
test("an async function's call rejects, not throws, when binding throws", async () => {
  const c = async ({ id }) => id
  let promise
  assert.doesNotThrow(() => { promise = c() })
  await assert.rejects(promise, TypeError)
})
