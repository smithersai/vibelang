import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const values: unknown[] = ["ready", "other", 0, null, {}, Symbol("x")]
return values.map(s => s === "ready" ? "hit" : "miss")
}) }
