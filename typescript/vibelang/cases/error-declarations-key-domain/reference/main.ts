import { Data, Effect, Schema } from "effect"
enum Key { Count = "count" }
const token: unique symbol = Symbol("safe")
class Numeric extends Schema.TaggedError<Numeric>()("Numeric", { [7]: Schema.Number }) {}
class Symbolic extends Schema.TaggedError<Symbolic>()("Symbolic", { [token]: Schema.Number }) {}
class EnumSafe extends Schema.TaggedError<EnumSafe>()("EnumSafe", { [Key.Count]: Schema.Number }) {}
function generic<K extends `x_${string}`>(key: K) {
  class Safe extends Schema.TaggedError<Safe>()("Safe", { [key]: Schema.Number }) {}
  return Safe
}
function impossible(key: never) {
  class Impossible extends Schema.TaggedError<Impossible>()("Impossible", { [key]: Schema.Number }) {}
  return Impossible
}
export function main() {
  return Effect.gen(function* () {
    return [new Numeric({ 7: 1 })[7], new Symbolic({ [token]: 2 })[token], new EnumSafe({ count: 3 }).count]
  })
}
