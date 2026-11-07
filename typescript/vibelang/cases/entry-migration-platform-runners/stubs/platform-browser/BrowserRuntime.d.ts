import type { Effect } from "effect/Effect"

export declare const runMain: {
  (options?: { readonly disableErrorReporting?: boolean | undefined }): <E, A>(effect: Effect<A, E>) => void
  <E, A>(effect: Effect<A, E>, options?: { readonly disableErrorReporting?: boolean | undefined }): void
}
