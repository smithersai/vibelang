import { Effect } from "effect"

export const read = Effect.tryPromise({ try: () => Promise.resolve(1), catch: (e) => e })
