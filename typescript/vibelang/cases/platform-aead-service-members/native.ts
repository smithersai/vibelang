import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Aead } from "effect/crypto"

export const keyBytes = new Uint8Array(32)
export const data = new Uint8Array([4])
export const nonce = new Uint8Array(12)

export const fixed = {
  generateKey: (_algorithm: Aead.Algorithm) => Effect.die("unused generateKey"),
  encrypt: (_key: Aead.Key, data: Uint8Array, _options: { readonly nonce: Uint8Array }) => Effect.succeed(data),
  decrypt: (_key: Aead.Key, data: Uint8Array, _options: { readonly nonce: Uint8Array }) => Effect.succeed(data)
}
export const expected = Effect.provide(Effect.gen(function* () {
  const key = yield* Aead.key(Aead.aes256Gcm, keyBytes)
  const aead = yield* Aead.Aead
  const ciphertext = yield* aead.encrypt(key, data, { nonce })
  const plaintext = yield* aead.decrypt(key, ciphertext, { nonce })
  return plaintext[0]
}), Layer.succeed(Aead.Aead, fixed))
