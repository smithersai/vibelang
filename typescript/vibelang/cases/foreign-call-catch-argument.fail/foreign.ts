import { Effect } from "effect"
export function view<T>(options: { initialValue: T }): { value: T } { return { value: options.initialValue } }
export const terminal = { prompt: { screen<T>(view: { value: T }): Effect.Effect<T, { _tag: "Cancelled" }> { return Effect.succeed(view.value) } } }
