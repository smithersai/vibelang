import { Effect } from "effect"
let executed = 0
function work() { return Effect.sync(() => { executed++; return 7 }) }
const held = work()
class Store {
  static readonly program = work()
  readonly program = work()
  get another() { return work() }
}
const store = new Store()
function keep(program: Effect.Effect<number> = work()) { return program }
const programs = [held, Store.program, store.program, store.another, keep()]
export function main() {
  return Effect.gen(function* () {
    const before = executed
    let total = 0
    for (const program of programs) total += yield* program
    return { before, after: executed, total }
  })
}
