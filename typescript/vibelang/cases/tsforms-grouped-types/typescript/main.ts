import type { Effect } from "effect"
// Chapter 007: grouped quick fixes preserve declaration output.
export type Maybe = Effect.Effect<number> | null
export interface Client {
 readonly run: <A, E>(p: Effect.Effect<A, E>) => Effect.Effect<A, E | Error>
}
export type Resource<R, S> = Effect.Effect<void, Error, R | S>
export type Callback = Effect.Effect<() => number>
// t3code apps/web/src/connection/storage.ts: a union success slot.
export type Get = (key: string) => Effect.Effect<string | null, Error>
// t3code apps/desktop/src/app/DesktopStartupRecovery.ts: a leading-bar union requirements slot.
export type Listen = Effect.Effect<
  void,
  Error,
  | RangeError
  | TypeError
>
// t3code apps/web/src/lib/backgroundActivityReporter.ts: an Effect type in the success slot.
export type Outer = Effect.Effect<Effect.Effect<void>>
