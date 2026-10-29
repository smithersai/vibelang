/**
 * The Node layer of `Experimental.Crypto` (D313).
 *
 * @since 0.0.11
 */
import * as EffectNodeCrypto from "@effect/platform-node/NodeCrypto"
import * as Layer from "effect/Layer"
import type * as Crypto from "../Crypto.js"
import * as CryptoExtension from "../internal/crypto.js"

/**
 * Provides `Experimental.Crypto` and `@effect/platform-node`'s Effect crypto services,
 * such as `SecureRandom` and `Digest`.
 *
 * @since 0.0.11
 */
export const layer: Layer.Layer<Crypto.Crypto | Layer.Success<typeof EffectNodeCrypto.layer>> = Layer.merge(
  CryptoExtension.layer,
  EffectNodeCrypto.layer
)
