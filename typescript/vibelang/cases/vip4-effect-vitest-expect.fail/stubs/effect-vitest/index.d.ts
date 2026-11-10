// @effect/vitest 4.1.1 re-exports vitest and declares it.effect itself.
import type { Effect } from "effect"
export * from "vitest"
export declare const it: {
  effect(name: string, self: () => Effect.Effect<void, unknown>): void
}
