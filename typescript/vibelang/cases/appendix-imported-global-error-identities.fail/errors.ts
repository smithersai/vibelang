import { Effect } from "effect"

export const failing = Effect.fail(new Error("boom"))
export const caught = Effect.tryPromise({ try: () => Promise.resolve(1), catch: () => new Error("lost") })
