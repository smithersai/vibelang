import { Context } from "effect"
// Compile a consumer against the installed package export and emitted .d.ts files.
import { trusted, $errors, $bind, $direct, $done, $fast, $isRun, $program, $settle, $produce, $region, $using, $yield, Effect, Layer, Scope, suspend, type Producer } from "vibelang-runtime"

const bound: Effect.Effect<number> = $bind(42)
const program: Effect.Effect<number> = $program(() => bound)
const producer: Producer<number, never, never> = $produce(() => $yield(42))
const acquire: Effect.Effect<string, never, Scope.Scope> = Effect.acquireRelease(Effect.succeed("resource"), () => Effect.void)
const region: Effect.Effect<string> = $region(scope => $using(scope, acquire))
const callback: Effect.Effect<number> = suspend<number>(resumer => { resumer.resume(42) })
const layer: Layer.Layer<never> = Layer.empty
const runs: boolean = $isRun(bound)
const key: typeof $direct = Symbol.for("vibelang/direct") as typeof $direct
const body = function* (n: number) { return n + ((yield* Effect.fail("Bad" as const)) as number) }
const entry: (n: number) => number | Effect.Effect<number, "Bad", never> = $fast(body)
const it = body(1), s = it.next()
const step: number | Effect.Effect<number, "Bad", never> = s.done ? $done(s.value) : $settle(it, s)
const settled: Effect.Effect<number, "Bad"> = Effect.gen(function* () { const t = entry(1); return Effect.isEffect(t) ? yield* t : t })
void [program, producer, region, callback, layer, runs, key, step, settled]

class PortError extends Error { readonly kind = "port" }
class HostError extends Error { readonly kind = "host" }
const parse = trusted((text: string, ...suffix: string[]) => text.length + suffix.length, [PortError, HostError])
const parsed: number = parse("80", "a", "b")
const listed: readonly [typeof PortError, typeof HostError] = parse[$errors]
// @ts-expect-error A trusted value is a plain function, not an Effect (D514).
const notProgram: Effect.Effect<number, PortError | HostError> = parse("80")
// @ts-expect-error The implementation's parameters are preserved.
parse(80)
const pure: string = trusted((n: number) => String(n), [])(1)
// @ts-expect-error Promise implementations need an asynchronous boundary.
trusted(async () => 1, [])
// @ts-expect-error Effect implementations already carry their own contract.
trusted(() => Effect.succeed(1), [])
// @ts-expect-error A union cannot hide a Promise return.
trusted((n: boolean) => n ? 1 : Promise.resolve(1), [])
void [parsed, listed, notProgram, pure]

/** VIP-21 / detail225: Stream.callback supplies Scope, but no other service. */
const scopedProducer: Producer<number> = $produce(() => Effect.andThen(acquire, $yield(42)))
class ProducerHost extends Context.Service<ProducerHost, number>()("ProducerHost") {}
const serviceProducer = $produce(() => Effect.gen(function* () {
  yield* acquire
  yield* ProducerHost
  yield* $yield(42)
}))
const requiresHost: Producer<number, never, ProducerHost> = serviceProducer
// @ts-expect-error The callback's Scope must not erase unrelated services.
const missingHost: Producer<number> = serviceProducer
void [scopedProducer, requiresHost, missingHost]
