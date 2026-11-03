import * as Effect from "effect/Effect"
// @ts-expect-error A namespace is not a global Effect type alias.
export type NotGlobal=Effect<number>
export type Canonical=Effect.Effect<number>
