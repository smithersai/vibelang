import { Context, Effect, Layer } from "effect"

/**
 * A layer that provides one service, for a provider written `Key = value` in a
 * provide block (VIP-12):
 *
 *     provide Clock = testClock, Users = fakeUsers { app() }
 *
 * compiles to `$provideEntries(..., [$provideService(Clock, "Clock", testClock),
 * $provideService(Users, "Users", fakeUsers)])`. Each entry is an ordinary
 * `Layer.succeed` provider, built through `Effect.provide` in source order.
 * The key is a service key, such as a `service`
 * declaration, or a module whose export of the same name is one, so the
 * effect module `Clock` stands for `Clock.Clock`.
 *
 * One signature, with the name before the value, so TypeScript knows the key
 * and the name when it first checks the value. With an overload per form, it
 * checked the value against the first overload's shape, and a method in the
 * value took the form that shape gave it (D92) for every later overload.
 */
export function $provideService<const N extends string, K extends Context.Key<any, any> | { readonly [P in N]: Context.Key<any, any> }>(
  key: K,
  name: N,
  value: NoInfer<Context.Service.Shape<ProvidedKey<K, N>>>
): Layer.Layer<Context.Service.Identifier<ProvidedKey<K, N>>>
export function $provideService(key: any, name: string, value: unknown): Layer.Layer<any> {
  const service = Context.isKey(key) ? key : key[name]
  if (!Context.isKey(service)) {
    throw new TypeError(`provide ${name} = ...: ${name} is not a service key, and it has no service key named ${name}`)
  }
  return Layer.succeed(service as Context.Key<any, any>)(value)
}

/**
 * Runs a block with exactly the providers Effect.provide receives. A later
 * provider wins for a duplicate service, whether it is a written Layer or a
 * Key = value entry. Native layer scope, memoization and finalization apply.
 */
export const $provideEntries: {
  <const Layers extends [Layer.Any, ...Array<Layer.Any>]>(layers: Layers): <A, E, R>(
    self: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | Layer.Error<Layers[number]>, Layer.Services<Layers[number]> | Exclude<R, Layer.Success<Layers[number]>>>
  <A, E, R, const Layers extends [Layer.Any, ...Array<Layer.Any>]>(
    self: Effect.Effect<A, E, R>,
    layers: Layers
  ): Effect.Effect<A, E | Layer.Error<Layers[number]>, Layer.Services<Layers[number]> | Exclude<R, Layer.Success<Layers[number]>>>
} = function(...args: Array<any>): any {
  return args.length === 1 ? (self: Effect.Effect<any, any, any>) => provideEntries(self, args[0]) : provideEntries(args[0], args[1])
}

function provideEntries(self: Effect.Effect<any, any, any>, layers: ReadonlyArray<Layer.Any>): Effect.Effect<any, any, any> {
  return layers.length === 1
    ? Effect.provide(self, layers[0] as Layer.Layer<any, any, any>)
    : Effect.provide(self, layers as [Layer.Any, ...Array<Layer.Any>])
}

/** The service key that `key` names: the key itself, or its export named `name`. */
type ProvidedKey<K, N extends string> = K extends Context.Key<any, any> ? K
  : K extends { readonly [P in N]: infer Key } ? Key
  : never
