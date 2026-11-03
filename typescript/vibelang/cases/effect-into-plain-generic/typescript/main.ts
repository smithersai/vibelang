import { Effect } from "effect"

function expect<T>(value: T): { readonly value: T } {
  return { value }
}

export function main() {
  return Effect.gen(function* () {
    let runs = 0
    function awaited(p: number) {
      return Effect.gen(function* () {
        runs++
        return p
      })
    }
    const program = awaited(7)
    const observed = expect(program)
    const inferred: Effect.Effect<number> = observed.value
    // @ts-expect-error An unrun Effect is not a number.
    const wrong: number = observed.value
    const cold = runs
    const same = observed.value === program
    const value = yield* inferred
    const once = runs
    const explicit = expect(yield* awaited(8)).value
    return { cold, same, value, runs: once, explicit, total: runs }
  })
}
