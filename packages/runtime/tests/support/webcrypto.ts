import { Effect } from "effect"
import { WebCrypto } from "effect/crypto"

/**
 * Effect's workflow engine names each run and activity with a SHA-256 digest
 * through WebCrypto. The digest finishes on the event loop, outside Effect's
 * scheduler, so no number of yields is sure to outlast it: on a busy host a
 * test that counts yields reads a launch still in flight.
 *
 * `layerCrypto` provides the host's WebCrypto and records each digest in
 * flight. `settle` drains the scheduler, and while a digest is in flight it
 * waits for the digest in real time and drains again. A test provides
 * `layerCrypto` around everything it starts, or `settle` cannot see the
 * digests. `layerSlowCrypto` finishes each digest the given number of
 * milliseconds late, as a busy host does.
 */
const inFlight = new Set<Promise<ArrayBuffer>>()
const host = globalThis.crypto

const counting = (millis: number) => ({
  getRandomValues: host.getRandomValues.bind(host),
  randomUUID: host.randomUUID.bind(host),
  subtle: {
    digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => {
      const digest = millis === 0
        ? host.subtle.digest(algorithm, data)
        : new Promise((resolve) => setTimeout(resolve, millis)).then(() => host.subtle.digest(algorithm, data))
      inFlight.add(digest)
      const done = () => {
        inFlight.delete(digest)
      }
      digest.then(done, done)
      return digest
    }
  }
}) as unknown as Crypto

export const layerCrypto = WebCrypto.layer(counting(0))

export const layerSlowCrypto = (millis: number) => WebCrypto.layer(counting(millis))

const drain = Effect.repeat(Effect.yieldNow, { times: 200 })

export const settle = Effect.gen(function*() {
  yield* drain
  while (inFlight.size > 0) {
    yield* Effect.promise(() => Promise.allSettled([...inFlight]))
    yield* drain
  }
})
