import { Context, Effect, Layer } from "effect"
import { clock, randomness } from "./native.js"
export function clockValue(input: Performance) { return input.now() }
export function uuidValue(input: Crypto) { return input.randomUUID() }
export function bytesValue(input: Crypto) { return input.getRandomValues(new Uint8Array(2)) }
class Inputs extends Context.Service<Inputs, { clock: Performance }>()("test/Inputs") {}
const fromService = Effect.gen(function* () { const clock = (yield* Inputs).clock; return yield* Effect.try(() => clock.now()) })
export const main = Effect.provide(
  Effect.gen(function* () {
    return [clockValue(clock), uuidValue(randomness), Array.from(bytesValue(randomness)), yield* fromService]
  }),
  Layer.succeed(Inputs, { clock }),
)
