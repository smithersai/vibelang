import { Effect } from "effect"

export const calls: string[] = []
const key = Symbol("method")
class Counter {
  offset = 3;
  [key](n: number) {
    return Effect.gen({ self: this }, function* () {
      calls.push("method")
      return yield* Effect.succeed(this.offset + n)
    })
  }
  static ["read"](n: number) {
    return Effect.gen(function* () { return yield* Effect.succeed(n) })
  }
  ["identity"]<T>(value: T) {
    return Effect.gen(function* () { return yield* Effect.succeed(value) })
  }
}
const counter = {
  offset: 5,
  [key](n: number) {
    return Effect.gen({ self: this }, function* () {
      calls.push("method")
      return yield* Effect.succeed(this.offset + n)
    })
  },
}
class Ordinary {
  effect: { [key]: number } = { [key]: 11 }
}
export function main() {
  return Effect.gen(function* () {
    return {
      classValue: yield* new Counter()[key](2),
      staticValue: yield* Counter.read(7),
      objectValue: yield* counter[key](4),
      genericValue: yield* new Counter().identity("ok"),
      namedEffect: new Ordinary().effect[key],
    }
  })
}
