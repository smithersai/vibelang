import { Effect } from "effect"

export const fromTypeScript = Effect.gen(function* () {
  return yield* Effect.succeed(1)
})
// Chapter 900: EK1002 diagnostic - spec-rule: docs/design/src/900-appendices.md#242754da82a91335
