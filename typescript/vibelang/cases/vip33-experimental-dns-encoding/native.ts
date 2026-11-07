import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import { Base64, Base64Url } from "effect/encoding"
import * as NodeDns from "@effect/platform-node/NodeDns"
import { Dns as EffectDns } from "effect/net"
import { Dns, Encoding } from "vibelang-runtime/experimental"
import { ExperimentalNodeDns } from "vibelang-runtime/experimental/platform-node"
import { ExperimentalWorkerDns } from "vibelang-runtime/experimental/platform-worker"
import { connect, discovery } from "./fixture.ts"

const name = "_acme-challenge.example.test"

const txtAt = (server: string) => Effect.gen(function* () {
  const dns = yield* Dns.Dns
  return yield* Effect.catch(dns.resolveTxtAt(server, name), (error) => Effect.succeed(error.reason))
})

const effectService = () => Effect.provide(Effect.gen(function* () { return yield* EffectDns.Dns }), NodeDns.layer)

const extendedService = () => Effect.provide(Effect.gen(function* () {
  const service = yield* Dns.Dns
  return { service, shared: service === (yield* EffectDns.Dns) }
}), ExperimentalNodeDns.layer)

export const extension = () => Effect.gen(function* () {
  const base = yield* effectService()
  const extended = yield* extendedService()
  return {
    added: Object.keys(extended.service).filter((key) => !(key in base)),
    missing: Object.keys(base).filter((key) => !(key in extended.service)),
    shared: extended.shared,
  }
})

export const node = (authority: string, configured: string) =>
  Effect.provide(txtAt(authority), ExperimentalNodeDns.layerWith({ nameServers: [configured], timeout: 500, tries: 1 }))

export const worker = (flags: number) =>
  Effect.provide(txtAt("192.0.2.53"), Layer.provide(ExperimentalWorkerDns.layerWith({ connect: connect(flags) }), discovery))

export const workerWithoutSockets = () =>
  Effect.provide(txtAt("192.0.2.53"), Layer.provide(ExperimentalWorkerDns.layer, discovery))

export function decode(input: string) {
  const lenient = Encoding.decodeBase64Lenient(input)
  return {
    lenient: Result.isSuccess(lenient) ? Array.from(lenient.success) : null,
    strict: Result.isSuccess(Base64.decode(input)),
    url: Result.isSuccess(Base64Url.decode(input)),
  }
}
