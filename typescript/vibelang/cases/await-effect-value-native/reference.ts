import { Effect } from "effect"

let starts = 0
export function started() { return starts }
export function make() {
  return Effect.sync(() => { starts++; return 7 })
}

export async function value(program: Effect.Effect<number>) {
  return await program
}

export async function* values(program: Effect.Effect<number>): AsyncGenerator<Effect.Effect<number>, void, unknown> {
  yield await program
}
