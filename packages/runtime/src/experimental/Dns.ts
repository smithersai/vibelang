/**
 * Effect's DNS service plus a direct-authority TXT query. Discovery, ordinary
 * record queries, lookups, reverse lookups and record values remain Effect's.
 * @experimental
 * @since 0.0.12
 */
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Dns as EffectDns } from "effect/net"
import * as Result from "effect/Result"

/** Direct-authority failures never include TXT payloads. @since 0.0.12 */
export class AuthoritativeDnsError extends /* @__PURE__ */ Data.TaggedError("AuthoritativeDnsError")<{
  readonly reason: "Unsupported" | "BadArgument" | "InvalidData" | "NotAuthoritative" | "NotFound" | "Timeout" | "Transport"
  readonly operation: "resolveTxtAt"
  readonly message: string
}> {}

type BaseService = EffectDns.Dns["Service"]

/** Effect's implementation, extended only with the missing operation. @since 0.0.12 */
export interface Service extends BaseService {
  /** One string per TXT RR, with character-string chunks joined. No recursive fallback. */
  readonly resolveTxtAt: (server: string, name: string) => Effect.Effect<ReadonlyArray<string>, AuthoritativeDnsError>
}

/** Distinct from Effect's key; platform layers provide both keys. @since 0.0.12 */
export class Dns extends /* @__PURE__ */ Context.Service<Dns, Service>()("vibelang/experimental/Dns") {}

/** Keeps every Effect member as the original function. @since 0.0.12 */
export const make = (base: EffectDns.Dns["Service"], resolveTxtAt: Service["resolveTxtAt"]): Service =>
  Dns.of({ ...base, resolveTxtAt })

/** Effect's static resolver and an explicitly replaceable authority query. @since 0.0.12 */
export const layerTest = (impl: Partial<Service> = {}): Layer.Layer<Dns | EffectDns.Dns> => {
  const base = { ...Result.getOrThrow(EffectDns.makeStatic({})), ...impl }
  const service = make(base, impl.resolveTxtAt ?? (() => Effect.succeed([])))
  return Layer.merge(Layer.succeed(EffectDns.Dns, service), Layer.succeed(Dns, service))
}
