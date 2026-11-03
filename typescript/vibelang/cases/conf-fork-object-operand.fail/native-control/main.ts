// Pin the actual Effect program type: forkChild also accepts option-shaped objects.
import { Effect } from "effect"
const value = 1
const name = "item"
const object = { value: 1 }
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ value: 1 })
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({})
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ value })
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ [name]: value })
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ ...object })
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ get value() { return 1 } })
// @ts-expect-error VIP-17 forks an Effect, never a plain object.
Effect.forkChild<Effect.Effect<unknown, unknown, unknown>>({ value() { return 1 } })
