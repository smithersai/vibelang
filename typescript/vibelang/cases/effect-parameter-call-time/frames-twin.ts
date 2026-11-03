import { Effect } from "effect"
function Witness(f = (() => {
  const target = new.target
  return () => Effect.gen(function* () { return target === undefined ? 1 : 2 })
})()) { return f() }
export function constructDefault() {
  return Effect.gen(function* () { return yield* (Reflect.construct(Witness, []) as ReturnType<typeof Witness>) })
}
const offset = (n: number) => 30 + n
Object.defineProperty(offset, "call", { value: () => -1000 })
class Base { get offset() { return offset } }
class Derived extends Base {
  n = 7
  value() {
    const self = this
    const get = () => super.offset
    return Effect.gen(function* () { return self.n + Reflect.apply(get(), self, [0]) })
  }
}
export function directSuper() { return new Derived().value() }
