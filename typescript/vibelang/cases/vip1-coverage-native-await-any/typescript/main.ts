import { Effect } from "effect"
async function wait(value: any) { return await value }
export function main(): Effect.Effect<readonly [boolean, number], unknown> {
  let runs = 0
  const program = Effect.sync(() => ++runs)
  return Effect.map(Effect.tryPromise(() => wait(program)), held => [held === program, runs] as const)
}
