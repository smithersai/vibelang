import { Effect } from "effect"
export function initialDo(): string {
  let read: () => number = () => 0
  initial: {
    // Intentional checking bypass: leaving before initialization retains TDZ.
    // @ts-ignore
    read = () => n
    break initial
    let n = 1
  }
  try { return String(read()) } catch (error) { return error instanceof ReferenceError ? "tdz" : "wrong" }
}
export function main(): Effect.Effect<unknown> { return Effect.sync(initialDo) }
