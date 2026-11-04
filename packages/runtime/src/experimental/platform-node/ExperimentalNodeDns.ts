/**
 * Extends Effect's NodeDns, sharing its ordinary resolver on both keys.
 * Direct-authority queries reuse Effect NodeDns.make with only that server;
 * closing the query scope cancels its resolver. Node does not expose AA.
 * @experimental
 * @since 0.0.12
 */
import * as NodeDns from "@effect/platform-node/NodeDns"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Dns as EffectDns } from "effect/net"
import * as Dns from "../Dns.js"

/** Effect's own resolver options, with no duplicate discovery API. @since 0.0.12 */
export const layerWith = (options: NodeDns.Options = {}) => Layer.effectContext(Effect.gen(function*() {
  const base = yield* NodeDns.make(options)
  const service = Dns.make(base, (server, name) => Effect.scoped(Effect.gen(function*() {
    // Effect validates the server before make: an empty nameServers list would
    // otherwise retain the system resolver, which is forbidden for this query.
    const address = yield* Effect.fromResult(EffectDns.nameServerFromString(server))
    const authority = yield* NodeDns.make({ ...options, nameServers: [address] })
    const records = yield* authority.resolve(name, "TXT")
    return records.map((record) => record.chunks.join(""))
  })).pipe(Effect.mapError((cause) => new Dns.AuthoritativeDnsError({
    operation: "resolveTxtAt",
    reason: cause._tag === "NetAddressError" ? "BadArgument"
      : cause.reason === "NotFound" ? "NotFound" : cause.reason === "Timeout" ? "Timeout"
      : cause.reason === "BadName" ? "BadArgument" : cause.reason === "Unsupported" ? "Unsupported"
      : cause.reason === "InvalidResponse" ? "InvalidData" : "Transport",
    message: "Direct-authority DNS query failed"
  }))))
  return Context.make(EffectDns.Dns, service).pipe(Context.add(Dns.Dns, service))
}))

/** @since 0.0.12 */
export const layer = Layer.orDie(layerWith())
