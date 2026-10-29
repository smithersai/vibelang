/**
 * Experimental: the members of Effect 4.0's `Crypto` service plus `hmac`,
 * `sign` and `verify` (D313).
 *
 * Effect 4.1 replaced its `Crypto` service with the family services of
 * `effect/crypto`: `SecureRandom`, `Digest`, `Mac`, `Signature` and the
 * rest. This service keeps the members it had, `randomBytes`, `digest`,
 * `randomUUIDv4` and the others, on its own key, with `hmac`, `sign` and
 * `verify` beside them. One WebCrypto implementation (`crypto.subtle`, which
 * Node, Bun, Deno, browsers and Workers all have) serves every platform; the
 * layers in `vibelang-runtime/experimental/platform-node`, `-bun` and
 * `-browser` provide it and that platform's Effect crypto services. Secret
 * keys are `Redacted`, so logs and errors never print them.
 *
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as SecureRandom from "effect/crypto/SecureRandom"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import * as Redacted from "effect/Redacted"

/**
 * A digest algorithm, as Effect 4.0's `Crypto.DigestAlgorithm` named it.
 *
 * @since 0.0.12
 */
export type DigestAlgorithm = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512"

/**
 * A signature algorithm. `"ECDSA-P256-SHA256"` is ECDSA on the P-256 curve
 * with SHA-256, whose signatures are the 64 bytes r‖s that WebCrypto writes
 * (not DER). `"Ed25519"` signatures are 64 bytes.
 *
 * @since 0.0.11
 */
export type SignatureAlgorithm = "ECDSA-P256-SHA256" | "Ed25519"

/**
 * The implementation: the members of Effect 4.0's `Crypto` plus `hmac`,
 * `sign` and `verify`.
 *
 * @since 0.0.11
 */
export interface Service {
  /** A random safe integer, read synchronously. */
  nextIntUnsafe(): number
  /** A random number from 0 up to 1, read synchronously. */
  nextDoubleUnsafe(): number
  /** `size` new random bytes; a size that is not a non-negative safe integer fails with `BadArgument`. */
  randomBytes(size: number): Effect.Effect<Uint8Array, PlatformError.PlatformError>
  /** The digest of `data` under `algorithm`. */
  digest(algorithm: DigestAlgorithm, data: Uint8Array): Effect.Effect<Uint8Array, PlatformError.PlatformError>
  /** A random number from 0 up to 1. */
  readonly random: Effect.Effect<number>
  /** A random boolean. */
  readonly randomBoolean: Effect.Effect<boolean>
  /** A random safe integer. */
  readonly randomInt: Effect.Effect<number>
  /** A random number from `min` up to `max`. */
  randomBetween(min: number, max: number): Effect.Effect<number>
  /** A random integer from `min` to `max`, or up to `max` with `halfOpen`. */
  randomIntBetween(min: number, max: number, options?: {
    readonly halfOpen?: boolean | undefined
  }): Effect.Effect<number>
  /** The elements in a random order. */
  randomShuffle<A>(elements: Iterable<A>): Effect.Effect<Array<A>>
  /** A random UUIDv4, as a hex string or its 16 bytes. */
  randomUUIDv4(options?: {
    readonly format?: "hex" | undefined
  }): Effect.Effect<string, PlatformError.PlatformError>
  randomUUIDv4<Format extends "hex" | "bytes">(options: {
    readonly format: Format
  }): Effect.Effect<Format extends "bytes" ? Uint8Array : string, PlatformError.PlatformError>
  randomUUIDv4(options?: {
    readonly format?: "hex" | "bytes" | undefined
  }): Effect.Effect<string | Uint8Array, PlatformError.PlatformError>
  /** A UUIDv7 from the Clock and random bytes, as a hex string or its 16 bytes. */
  randomUUIDv7(options?: {
    readonly format?: "hex" | undefined
  }): Effect.Effect<string, PlatformError.PlatformError>
  randomUUIDv7<Format extends "hex" | "bytes">(options: {
    readonly format: Format
  }): Effect.Effect<Format extends "bytes" ? Uint8Array : string, PlatformError.PlatformError>
  randomUUIDv7(options?: {
    readonly format?: "hex" | "bytes" | undefined
  }): Effect.Effect<string | Uint8Array, PlatformError.PlatformError>
  /** A ULID from the Clock and random bytes. */
  readonly randomULID: Effect.Effect<string, PlatformError.PlatformError>

  /**
   * Computes the HMAC of `data` under `key`, the raw secret bytes.
   */
  hmac(
    algorithm: DigestAlgorithm,
    key: Redacted.Redacted<Uint8Array>,
    data: Uint8Array
  ): Effect.Effect<Uint8Array, PlatformError.PlatformError>

  /**
   * Signs `data` with `privateKey`, a PKCS#8 DER private key. A key that is
   * not one for `algorithm` fails with `BadArgument`.
   */
  sign(
    algorithm: SignatureAlgorithm,
    privateKey: Redacted.Redacted<Uint8Array>,
    data: Uint8Array
  ): Effect.Effect<Uint8Array, PlatformError.PlatformError>

  /**
   * Reports whether `signature` signs `data` under `publicKey`, an SPKI DER
   * public key: `false` for a signature that does not match. A key that is
   * not one for `algorithm` fails with `BadArgument`.
   */
  verify(
    algorithm: SignatureAlgorithm,
    publicKey: Uint8Array,
    signature: Uint8Array,
    data: Uint8Array
  ): Effect.Effect<boolean, PlatformError.PlatformError>
}

/**
 * The service key, declared as Effect declares a class service: the type
 * `Crypto` is the requirement, whose identity is its key, and `Service` is
 * the implementation.
 *
 * @since 0.0.11
 */
export class Crypto extends /* @__PURE__ */ Context.Service<Crypto, Service>()("vibelang/experimental/Crypto") {}

const signatureAlgorithms = {
  "ECDSA-P256-SHA256": { key: { name: "ECDSA", namedCurve: "P-256" }, sign: { name: "ECDSA", hash: "SHA-256" } },
  "Ed25519": { key: { name: "Ed25519" }, sign: { name: "Ed25519" } }
} satisfies Record<SignatureAlgorithm, { readonly key: EcKeyImportParams | Algorithm; readonly sign: EcdsaParams | Algorithm }>

const keyFormats = { raw: "a raw", pkcs8: "a PKCS#8 private", spki: "an SPKI public" }

// WebCrypto accepts only ArrayBuffer-backed bytes, so each input is copied.
const bytes = (data: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(data)

const unavailable = (method: string) =>
  Effect.fail(PlatformError.systemError({
    module: "Crypto",
    method,
    _tag: "Unknown",
    description: "crypto.subtle is not available"
  }))

// Runs a WebCrypto operation; a rejection is an Unknown system error.
const subtleCall = <A>(
  subtle: SubtleCrypto | undefined,
  method: string,
  operation: (subtle: SubtleCrypto) => Promise<A>
): Effect.Effect<A, PlatformError.PlatformError> =>
  subtle === undefined ? unavailable(method) : Effect.tryPromise({
    try: () => operation(subtle),
    catch: (cause) =>
      PlatformError.systemError({ module: "Crypto", method, _tag: "Unknown", description: `could not ${method}`, cause })
  })

// Imports a key for one use. Bytes that are not a key of the format and
// algorithm fail with BadArgument, which names neither the bytes nor the key.
const importKey = (
  subtle: SubtleCrypto | undefined,
  method: string,
  format: keyof typeof keyFormats,
  key: Uint8Array,
  algorithm: HmacImportParams | EcKeyImportParams | Algorithm,
  usage: KeyUsage
): Effect.Effect<CryptoKey, PlatformError.PlatformError> =>
  subtle === undefined ? unavailable(method) : Effect.tryPromise({
    try: () => subtle.importKey(format, bytes(key), algorithm, false, [usage]),
    catch: (cause) =>
      PlatformError.badArgument({
        module: "Crypto",
        method,
        description: `the key is not ${keyFormats[format]} key for ${algorithm.name}`,
        cause
      })
  })

// Reads 53 random bits, as Effect 4.0's Crypto did.
const readUint53 = (bytes: Uint8Array): number =>
  ((bytes[0]! & 0x1f) * 2 ** 48) + (bytes[1]! * 2 ** 40) + (bytes[2]! * 2 ** 32) +
  (bytes[3]! * 2 ** 24) + (bytes[4]! * 2 ** 16) + (bytes[5]! * 2 ** 8) + bytes[6]!

/**
 * Makes the service from a source of random bytes and a digest, as Effect
 * 4.0's `Crypto.make` did, with `hmac`, `sign` and `verify` from the
 * platform's WebCrypto, the `globalThis.crypto.subtle` of the moment `make`
 * runs. Without WebCrypto they fail with `Unknown`. UUIDs, ULIDs, integers
 * and shuffles come from Effect's `SecureRandom.make` over the same bytes.
 *
 * @since 0.0.11
 */
export const make = (impl: {
  readonly randomBytes: (size: number) => Uint8Array
  readonly digest: (algorithm: DigestAlgorithm, data: Uint8Array) => Effect.Effect<Uint8Array, PlatformError.PlatformError>
}): Service => {
  const subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle
  const secure = SecureRandom.make(impl.randomBytes)
  const nextDoubleUnsafe = (): number => readUint53(impl.randomBytes(7)) / 2 ** 53
  const nextIntUnsafe = (): number => {
    while (true) {
      const bytes = impl.randomBytes(7)
      const value = readUint53(bytes)
      if ((bytes[0]! & 0x20) === 0) return value + Number.MIN_SAFE_INTEGER
      if (value < Number.MAX_SAFE_INTEGER) return value + 1
    }
  }
  const uuid = (generate: SecureRandom.UuidGenerator) => (options?: { readonly format?: "hex" | "bytes" | undefined }) =>
    options?.format === "bytes" ? generate({ format: "bytes" }) : generate()
  return Crypto.of({
    nextIntUnsafe,
    nextDoubleUnsafe,
    randomBytes: (size) =>
      Number.isSafeInteger(size) && size >= 0
        ? Effect.sync(() => impl.randomBytes(size))
        : Effect.fail(PlatformError.badArgument({
          module: "Crypto",
          method: "randomBytes",
          description: "size must be a non-negative safe integer"
        })),
    digest: impl.digest,
    random: Effect.sync(nextDoubleUnsafe),
    randomBoolean: Effect.sync(() => nextDoubleUnsafe() > 0.5),
    randomInt: Effect.sync(nextIntUnsafe),
    randomBetween: (min, max) => Effect.sync(() => nextDoubleUnsafe() * (max - min) + min),
    randomIntBetween: (min, max, options) => secure.intBetween(min, max, options),
    randomShuffle: (elements) => secure.shuffle(elements),
    randomUUIDv4: uuid(secure.uuidV4) as Service["randomUUIDv4"],
    randomUUIDv7: uuid(secure.uuidV7) as Service["randomUUIDv7"],
    randomULID: secure.ulid,
    hmac: (algorithm, key, data) =>
      Effect.flatMap(
        importKey(subtle, "hmac", "raw", Redacted.value(key), { name: "HMAC", hash: algorithm }, "sign"),
        (secret) => subtleCall(subtle, "hmac", async (subtle) => new Uint8Array(await subtle.sign("HMAC", secret, bytes(data))))
      ),
    sign: (algorithm, privateKey, data) =>
      Effect.flatMap(
        importKey(subtle, "sign", "pkcs8", Redacted.value(privateKey), signatureAlgorithms[algorithm].key, "sign"),
        (secret) =>
          subtleCall(subtle, "sign", async (subtle) =>
            new Uint8Array(await subtle.sign(signatureAlgorithms[algorithm].sign, secret, bytes(data))))
      ),
    verify: (algorithm, publicKey, signature, data) =>
      Effect.flatMap(
        importKey(subtle, "verify", "spki", publicKey, signatureAlgorithms[algorithm].key, "verify"),
        (key) =>
          subtleCall(subtle, "verify", (subtle) =>
            subtle.verify(signatureAlgorithms[algorithm].sign, key, bytes(signature), bytes(data)))
      )
  })
}

// Digests through the WebCrypto of the moment the call runs.
const subtleDigest = (algorithm: DigestAlgorithm, data: Uint8Array) =>
  subtleCall(globalThis.crypto?.subtle, "digest", async (subtle) => new Uint8Array(await subtle.digest(algorithm, bytes(data))))

/**
 * The service from the platform's WebCrypto: `getRandomValues` for random
 * bytes and `crypto.subtle` for digests, HMACs and signatures.
 *
 * @since 0.0.12
 */
export const layerWebCrypto: Layer.Layer<Crypto> = /* @__PURE__ */ Layer.sync(Crypto, () =>
  make({ randomBytes: SecureRandom.randomBytesUnsafe, digest: subtleDigest }))

/**
 * A deterministic `Crypto` for tests: random bytes are zeros, so UUIDs and
 * shuffles repeat; digests, HMACs and signatures come from WebCrypto;
 * `crypto` replaces any member.
 *
 * @since 0.0.11
 */
export const layerTest = (crypto: Partial<Service> = {}): Layer.Layer<Crypto> =>
  Layer.succeed(Crypto, Crypto.of({
    ...make({ randomBytes: (size) => new Uint8Array(size), digest: subtleDigest }),
    ...crypto
  }))
