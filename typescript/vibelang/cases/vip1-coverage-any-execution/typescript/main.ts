import { Effect } from "effect"
function keep(callee: any) { return Effect.gen(function* () { return yield* Effect.try(() => callee()) }) }
function execute(callee: any) { return Effect.gen(function* () {
  const returned = yield* Effect.try(() => callee())
  return yield* returned
}) }
export function main() {
  let runs = 0
  const program = Effect.sync(() => ++runs)
  return Effect.gen(function* () {
    const saved = yield* keep(() => program)
    const before = runs
    const value = yield* execute(() => program)
    return [saved === program, before, value] as const
  })
}
