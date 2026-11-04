import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Signature } from "effect/crypto"

export const keyBytes = new Uint8Array(32)
export const data = new Uint8Array([3])

export const fixed = {
  generateKeyPair: (_algorithm: Signature.Algorithm) => Effect.die("unused generateKeyPair"),
  publicKeyOf: (_privateKey: Signature.PrivateKey) => Effect.die("unused publicKeyOf"),
  sign: (_key: Signature.PrivateKey, data: Uint8Array) => Effect.succeed(data),
  verify: (_key: Signature.PublicKey, _signature: Uint8Array, _data: Uint8Array) => Effect.succeed(true)
}
export const expected = Effect.provide(Effect.gen(function* () {
  const privateKey = yield* Signature.privateKey(Signature.ed25519, keyBytes)
  const publicKey = yield* Signature.publicKey(Signature.ed25519, keyBytes)
  const signature = yield* Signature.Signature
  const signed = yield* signature.sign(privateKey, data)
  return yield* signature.verify(publicKey, signed, data)
}), Layer.succeed(Signature.Signature, fixed))
