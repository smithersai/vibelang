import { Effect } from "effect"
export const events: string[] = []
export const value = Effect.succeed(1)
export const boom = new RangeError("nullable")
/** @throws {RangeError} */
export function maybe(mode: "value" | "empty" | "throw"): Effect.Effect<number> | undefined {
  events.push(mode)
  if (mode === "throw") throw boom
  return mode === "value" ? value : undefined
}
/** @throws {RangeError} */
export const absent: ((value: number) => Effect.Effect<number> | undefined) | undefined = undefined
export function argument(): number { events.push("argument"); return 1 }
