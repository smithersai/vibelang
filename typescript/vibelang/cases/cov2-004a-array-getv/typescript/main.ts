import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const values: unknown[] = ["ab", null, undefined, 1, ["a", "b"]]
return values.map(s => { if (s == null) return "other"; const method = (s as any)[Symbol.iterator]; if (typeof method !== "function") return "other"; const values = Array.from(method.call(s) as IterableIterator<unknown>); return values.length === 2 && values[0] === "a" && values[1] === "b" ? "word" : "other" })
}) }
