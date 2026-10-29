import { expect, test } from "bun:test"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as PlatformError from "effect/PlatformError"
import * as Redacted from "effect/Redacted"
import { Crypto } from "vibelang-runtime/experimental"
import { ExperimentalBrowserCrypto } from "vibelang-runtime/experimental/platform-browser"
import { ExperimentalBunCrypto, ExperimentalBunServices } from "vibelang-runtime/experimental/platform-bun"
import { ExperimentalNodeCrypto, ExperimentalNodeServices } from "vibelang-runtime/experimental/platform-node"

const hex = (text: string) => Uint8Array.from(Buffer.from(text, "hex"))
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")
const utf8 = (text: string) => new TextEncoder().encode(text)
const secret = (text: string) => Redacted.make(hex(text))
const tampered = (bytes: Uint8Array) => bytes.map((byte, i) => (i === 0 ? byte ^ 1 : byte))

const run = <A, E>(layer: Layer.Layer<Crypto.Crypto>, program: (crypto: Crypto.Service) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.provide(Effect.flatMap(Effect.service(Crypto.Crypto), program), layer))

const failure = <A>(layer: Layer.Layer<Crypto.Crypto>, program: (crypto: Crypto.Service) => Effect.Effect<A, PlatformError.PlatformError>) =>
  run(layer, (crypto) => Effect.flip(program(crypto)))

// RFC 4231, section 4: HMAC-SHA-256 test cases 1-4, 6 and 7 (case 5 truncates).
const rfc4231 = [
  ["0b".repeat(20), toHex(utf8("Hi There")), "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"],
  [toHex(utf8("Jefe")), toHex(utf8("what do ya want for nothing?")), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"],
  ["aa".repeat(20), "dd".repeat(50), "773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe"],
  ["0102030405060708090a0b0c0d0e0f10111213141516171819", "cd".repeat(50), "82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b"],
  ["aa".repeat(131), toHex(utf8("Test Using Larger Than Block-Size Key - Hash Key First")), "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"],
  ["aa".repeat(131), toHex(utf8("This is a test using a larger than block-size key and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.")), "9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2"]
] as const

// RFC 8032, section 7.1, test 1: the secret key as PKCS#8 DER, the public key as SPKI DER.
const ed25519 = {
  privateKey: "302e020100300506032b657004220420" + "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  publicKey: "302a300506032b6570032100" + "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  signature: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
}

// RFC 6979, appendix A.2.5: the P-256 key as PKCS#8 and SPKI DER, and the
// SHA-256 signature of "sample" as r‖s.
const p256 = {
  privateKey: "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721a1440342000460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299",
  publicKey: "3059301306072a8648ce3d020106082a8648ce3d0301070342000460fed4ba255a9d31c961eb74c6356d68c049b8923b61fa6ce669622e60f29fb67903fe1008b8bc99a41ae9e95628bc64f2f1b20c2d7e9f5177a3c294d4462299",
  signature: "efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8"
}

const layers = [
  ["ExperimentalNodeCrypto", ExperimentalNodeCrypto.layer],
  ["ExperimentalBunCrypto", ExperimentalBunCrypto.layer],
  ["ExperimentalBrowserCrypto", ExperimentalBrowserCrypto.layer],
  ["ExperimentalNodeServices", ExperimentalNodeServices.layer],
  ["ExperimentalBunServices", ExperimentalBunServices.layer],
  ["layerTest", Crypto.layerTest()]
] as const

for (const [name, layer] of layers) {
  test(`${name}: hmac matches RFC 4231 for SHA-256 and SHA-512`, async () => {
    for (const [key, data, mac] of rfc4231) {
      expect(toHex(await run(layer, (crypto) => crypto.hmac("SHA-256", secret(key), hex(data))))).toBe(mac)
    }
    expect(toHex(await run(layer, (crypto) => crypto.hmac("SHA-512", secret("0b".repeat(20)), utf8("Hi There"))))).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854"
    )
  })

  test(`${name}: Ed25519 signs RFC 8032's vector and verifies it, and a tampered signature or message fails`, async () => {
    const privateKey = Redacted.make(hex(ed25519.privateKey))
    const publicKey = hex(ed25519.publicKey)
    const signature = await run(layer, (crypto) => crypto.sign("Ed25519", privateKey, new Uint8Array()))
    expect(toHex(signature)).toBe(ed25519.signature)
    expect(await run(layer, (crypto) => crypto.verify("Ed25519", publicKey, signature, new Uint8Array()))).toBe(true)
    expect(await run(layer, (crypto) => crypto.verify("Ed25519", publicKey, tampered(signature), new Uint8Array()))).toBe(false)
    expect(await run(layer, (crypto) => crypto.verify("Ed25519", publicKey, signature, utf8("x")))).toBe(false)
  })

  test(`${name}: ECDSA P-256 verifies RFC 6979's signature and its own, and a tampered one fails`, async () => {
    const privateKey = Redacted.make(hex(p256.privateKey))
    const publicKey = hex(p256.publicKey)
    const sample = utf8("sample")
    expect(await run(layer, (crypto) => crypto.verify("ECDSA-P256-SHA256", publicKey, hex(p256.signature), sample))).toBe(true)
    expect(await run(layer, (crypto) => crypto.verify("ECDSA-P256-SHA256", publicKey, tampered(hex(p256.signature)), sample))).toBe(false)
    const signature = await run(layer, (crypto) => crypto.sign("ECDSA-P256-SHA256", privateKey, sample))
    expect(signature.length).toBe(64)
    expect(await run(layer, (crypto) => crypto.verify("ECDSA-P256-SHA256", publicKey, signature, sample))).toBe(true)
    expect(await run(layer, (crypto) => crypto.verify("ECDSA-P256-SHA256", publicKey, tampered(signature), sample))).toBe(false)
    expect(await run(layer, (crypto) => crypto.verify("ECDSA-P256-SHA256", publicKey, signature.subarray(1), sample))).toBe(false)
  })

  test(`${name}: a key of the wrong kind fails with BadArgument that names no key bytes`, async () => {
    const cases = [
      ["hmac", "the key is not a raw key for HMAC", (crypto: Crypto.Service) => crypto.hmac("SHA-256", Redacted.make(new Uint8Array()), utf8("data"))],
      ["sign", "the key is not a PKCS#8 private key for Ed25519", (crypto: Crypto.Service) => crypto.sign("Ed25519", Redacted.make(hex(p256.privateKey)), utf8("data"))],
      ["sign", "the key is not a PKCS#8 private key for ECDSA", (crypto: Crypto.Service) => crypto.sign("ECDSA-P256-SHA256", Redacted.make(hex(ed25519.publicKey)), utf8("data"))],
      ["verify", "the key is not an SPKI public key for ECDSA", (crypto: Crypto.Service) => crypto.verify("ECDSA-P256-SHA256", hex(ed25519.publicKey), new Uint8Array(64), utf8("data"))],
      ["verify", "the key is not an SPKI public key for Ed25519", (crypto: Crypto.Service) => crypto.verify("Ed25519", utf8("not a key"), new Uint8Array(64), utf8("data"))]
    ] as const
    for (const [method, description, program] of cases) {
      const error = await failure(layer, program)
      expect(error.reason._tag).toBe("BadArgument")
      expect(error.reason.module).toBe("Crypto")
      expect(error.reason.method).toBe(method)
      expect(error.message).toBe(`Crypto.${method}: ${description}`)
      expect(error.message).not.toContain(p256.privateKey.slice(-16))
    }
  })
}

test("ExperimentalNodeCrypto: provides the experimental Crypto and Node's Effect crypto services", async () => {
  const [random, digest, experimental] = await Effect.runPromise(Effect.provide(
    Effect.all([Effect.service(SecureRandom.SecureRandom), Effect.service(Digest.Digest), Effect.service(Crypto.Crypto)]),
    ExperimentalNodeCrypto.layer
  ))
  const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  expect(toHex(await Effect.runPromise(experimental.digest("SHA-256", utf8("abc"))))).toBe(abc)
  expect(toHex(await Effect.runPromise(digest.digest(Digest.sha256, utf8("abc"))))).toBe(abc)
  expect((await Effect.runPromise(random.randomBytes(4))).length).toBe(4)
  expect((await Effect.runPromise(experimental.randomUUIDv4())).length).toBe(36)
})

test("the members Effect 4.0's Crypto had keep their results", async () => {
  let next = 0
  const counter = (size: number) => Uint8Array.from({ length: size }, () => next++ % 256)
  const crypto = Crypto.make({ randomBytes: counter, digest: () => Effect.succeed(new Uint8Array()) })
  expect((await Effect.runPromise(crypto.randomBytes(3)))).toEqual(new Uint8Array([0, 1, 2]))
  const bad = await Effect.runPromise(Effect.flip(crypto.randomBytes(-1)))
  expect(bad.reason._tag).toBe("BadArgument")
  expect(bad.message).toBe("Crypto.randomBytes: size must be a non-negative safe integer")
  expect(await Effect.runPromise(crypto.randomUUIDv4())).toBe("03040506-0708-490a-8b0c-0d0e0f101112")
  expect((await Effect.runPromise(crypto.randomUUIDv4({ format: "bytes" }))).length).toBe(16)
  expect((await Effect.runPromise(crypto.randomUUIDv7({ format: "bytes" }))).length).toBe(16)
  expect((await Effect.runPromise(crypto.randomULID)).length).toBe(26)
  const n = await Effect.runPromise(crypto.randomIntBetween(1, 6))
  expect(n >= 1 && n <= 6).toBe(true)
  const x = await Effect.runPromise(crypto.random)
  expect(x >= 0 && x < 1).toBe(true)
  expect(Number.isSafeInteger(crypto.nextIntUnsafe())).toBe(true)
  expect((await Effect.runPromise(crypto.randomShuffle([1, 2, 3]))).sort()).toEqual([1, 2, 3])
})

test("a secret key stays redacted when printed", () => {
  const key = Redacted.make(hex(ed25519.privateKey))
  expect(String(key)).toBe("<redacted>")
  expect(JSON.stringify({ key })).not.toContain("9d61b1")
})

test("without WebCrypto, hmac, sign and verify fail with Unknown", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")!
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true })
  let crypto: Crypto.Service
  try {
    crypto = Crypto.make({ randomBytes: (size) => new Uint8Array(size), digest: () => Effect.succeed(new Uint8Array()) })
  } finally {
    Object.defineProperty(globalThis, "crypto", descriptor)
  }
  const layer = Layer.succeed(Crypto.Crypto, crypto)
  for (const [method, program] of [
    ["hmac", (crypto: Crypto.Service) => crypto.hmac("SHA-256", secret("0b"), utf8("data"))],
    ["sign", (crypto: Crypto.Service) => crypto.sign("Ed25519", Redacted.make(hex(ed25519.privateKey)), utf8("data"))],
    ["verify", (crypto: Crypto.Service) => crypto.verify("Ed25519", hex(ed25519.publicKey), new Uint8Array(64), utf8("data"))]
  ] as const) {
    const error = await failure(layer, program)
    expect(error.reason._tag).toBe("Unknown")
    expect(error.message).toBe(`Unknown: Crypto.${method}: crypto.subtle is not available`)
  }
})

test("a WebCrypto operation that rejects fails with Unknown and keeps its cause", async () => {
  const layer = Crypto.layerTest()
  const error = await failure(layer, (crypto) => crypto.digest("SHA-3" as Crypto.DigestAlgorithm, utf8("data")))
  expect(error.reason._tag).toBe("Unknown")
  expect(error.message).toBe("Unknown: Crypto.digest: could not digest")
  expect(error.reason.cause).toBeDefined()
})

test("layerTest: zero random bytes, real digests and overrides", async () => {
  const layer = Crypto.layerTest({ hmac: () => Effect.succeed(utf8("fixed")) })
  const experimental = await Effect.runPromise(Effect.provide(Effect.service(Crypto.Crypto), layer))
  expect(await Effect.runPromise(experimental.randomUUIDv4())).toBe("00000000-0000-4000-8000-000000000000")
  expect(toHex(await Effect.runPromise(experimental.digest("SHA-256", utf8("abc"))))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  )
  expect(new TextDecoder().decode(await Effect.runPromise(experimental.hmac("SHA-256", secret("00"), utf8("x"))))).toBe("fixed")
})
