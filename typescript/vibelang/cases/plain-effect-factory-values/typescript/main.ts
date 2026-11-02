import { Effect } from "effect"
import { make, state, invoke } from "./factory.ts"
const voidFactory: () => void = make
const unknownFactory: () => unknown = make
const functionValue: Function = make
const held: ReadonlyArray<() => void> = [make]
const record: { make(): void } = { make }
class Box { make() { return make() } }
const box: { make(): void } = new Box()
const same = voidFactory === make && unknownFactory === make && functionValue === make && held[0] === make && record.make === make
invoke(voidFactory)
invoke(unknownFactory)
invoke(functionValue as () => void)
invoke(held[0])
invoke(record.make)
invoke(box.make)
let bodies = 0
const written: () => void = () => Effect.gen(function* () { bodies++; return 7 })
const produced = written()
const before = bodies
export function main() {
  return Effect.gen(function* () {
    const value = yield* (produced as unknown as Effect.Effect<number>)
    return { factories: state.factories, runs: state.runs, before, after: bodies, value, same }
  })
}
