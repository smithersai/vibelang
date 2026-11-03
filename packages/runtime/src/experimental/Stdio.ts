/**
 * Effect's standard I/O service plus non-consuming stdin closure observation.
 * All argument effects, sinks and the input byte stream remain Effect's.
 *
 * @experimental
 * @since 0.0.11
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as EffectStdio from "effect/Stdio"

/** The implementation extends Effect's standard I/O without consuming stdin. @since 0.0.11 */
export interface Service extends EffectStdio.Stdio {
  /**
   * Waits for stdin's end or close, or returns immediately if it already ended
   * or was destroyed. Owns only end/close listeners, detached on completion,
   * interruption or setup failure. The transport retains all byte/error ownership.
   */
  readonly awaitInputClosed: Effect.Effect<void>
}

/** The experimental service key, distinct from Effect's Stdio. @since 0.0.11 */
export class Stdio extends /* @__PURE__ */ Context.Service<Stdio, Service>()("vibelang/experimental/Stdio") {}

/** Keeps every standard member unchanged and adds the closure Effect. @since 0.0.11 */
export const make = (stdio: EffectStdio.Stdio, impl: Pick<Service, "awaitInputClosed">): Service =>
  Stdio.of({ ...stdio, ...impl })

/** Deterministic standard I/O and an already-closed input by default. @since 0.0.11 */
export const layerTest = (impl: Partial<Service> = {}): Layer.Layer<Stdio | EffectStdio.Stdio> =>
  Layer.provideMerge(
    Layer.effect(Stdio, Effect.map(
      Effect.service(EffectStdio.Stdio),
      (stdio) => make(stdio, { awaitInputClosed: Effect.void, ...impl })
    )),
    EffectStdio.layerTest(impl)
  )
