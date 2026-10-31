// vibelang --fix writes Effect.gen programs with effect and try (D470, VIP-1,
// VIP-5). The migration renames this file to lib.vibe;
// migrate-effect-gen-fixed holds what --fix then writes, which main.ts runs
// with the same result, and whose declarations are the same (expected/lib.d.ts).
import { Effect, Layer } from "effect"
import { Gone, Users } from "./services.js"

// An arrow whose body is Effect.gen.
export const greet = (id: string) =>
  Effect.gen(function* () {
    const users = yield* Users
    const name = yield* users.find(id)
    return `Hello, ${name}`
  })

// A function whose only statement returns Effect.gen.
export function count(n: number) {
  return Effect.gen(function* () {
    let total = 0
    for (let i = 1; i <= n; i++) total += yield* Effect.succeed(i)
    return total
  })
}

// A method that passes this as the generator's self.
export class Box {
  constructor(readonly value: number) {}
  doubled() {
    return Effect.gen({ self: this }, function* () {
      const value = yield* Effect.succeed(this.value)
      return value * 2
    })
  }
}

// An error instance that a yield* fails with.
export const check = (n: number) =>
  Effect.gen(function* () {
    if (n < 0) return yield* new Gone({ id: n })
    return `ok ${n}`
  })

// A callback that returns the program it builds.
export const doubleAll = (xs: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    return yield* Effect.forEach(xs, (x) => Effect.succeed(x * 2))
  })

// A program value that a yield* runs, and a template literal that keeps its lines.
export const describe = (program: Effect.Effect<number>) =>
  Effect.gen(function* () {
    const n = yield* program
    return `n=${n}
  done`
  })

// A program where a layer takes one.
export const UsersLive = Layer.effect(
  Users,
  Effect.gen(function* () {
    const prefix = yield* Effect.succeed("user-")
    return { find: (id: string) => Effect.succeed(id === "1" ? "Ada" : prefix + id) }
  }),
)
