/**
 * The Bun layer of `Experimental.Crypto` (D313).
 *
 * @since 0.0.11
 */
import * as EffectBunCrypto from "@effect/platform-bun/BunCrypto"
import * as Layer from "effect/Layer"
import type * as Crypto from "../Crypto.js"
import * as CryptoExtension from "../internal/crypto.js"

/**
 * Provides `Experimental.Crypto` and `@effect/platform-bun`'s Effect crypto services,
 * such as `SecureRandom` and `Digest`.
 *
 * @since 0.0.11
 */
export const layer: Layer.Layer<Crypto.Crypto | Layer.Success<typeof EffectBunCrypto.layer>> = Layer.merge(
  CryptoExtension.layer,
  EffectBunCrypto.layer
)
