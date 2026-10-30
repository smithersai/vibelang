import { Effect } from "effect"

export class Numbers {
  offset = 3;
  1n(n: number) {
    return Effect.gen({ self: this }, function* () { return yield* Effect.succeed(this.offset + n) })
  }
  static 1_000n<T>(value: T) {
    return Effect.gen(function* () { return yield* Effect.succeed(value) })
  }
}
export const numbers = {
  offset: 5,
  2n(n: number) {
    return Effect.gen({ self: this }, function* () { return yield* Effect.succeed(this.offset + n) })
  },
}
