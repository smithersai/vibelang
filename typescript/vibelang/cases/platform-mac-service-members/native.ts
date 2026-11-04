import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Mac } from "effect/crypto"

export const keyBytes = new Uint8Array([1])
export const data = new Uint8Array([2])

export const fixed = {
  generateKey: (_algorithm: Mac.Algorithm) => Effect.die("unused generateKey"),
  sign: (_key: Mac.Key, data: Uint8Array) => Effect.succeed(data),
  verify: (_key: Mac.Key, _tag: Uint8Array, _data: Uint8Array) => Effect.succeed(true)
}
export const expected = Effect.provide(Effect.gen(function* () {
  const key = yield* Mac.key(Mac.hmacSha256, keyBytes)
  const mac = yield* Mac.Mac
  const bytes = yield* mac.sign(key, data)
  return bytes[0]
}), Layer.succeed(Mac.Mac, fixed))
