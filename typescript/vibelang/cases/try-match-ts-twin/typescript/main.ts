import * as Effect from "effect/Effect"

function a() { return Effect.gen(function* () { return "ran a" }) }
function b() { return Effect.gen(function* () { return 2 }) }

export function pick(kind: "a" | "b") {
  return Effect.gen(function* () {
    return yield* (kind === "a" ? a() : b())
  })
}

export function mixed(n: number) {
  return Effect.gen(function* () {
    return yield* (n === 1 ? Effect.succeed("one") : Effect.fail(new Error("no")))
  })
}

export function nested(n: number, m: number) {
  return Effect.gen(function* () {
    return yield* (n === 1 ? (m === 2 ? Effect.succeed(1) : Effect.succeed("x")) : Effect.succeed(0))
  })
}

export const inBlock = Effect.gen(function* () {
  const subject = ((value: number) => value)(7)
  return yield* (subject === 7 ? Effect.succeed(7) : Effect.succeed(0))
})

export function tail(n: number) {
  return Effect.gen(function* () {
    return yield* (n === 1 ? Effect.succeed("tail") : Effect.succeed(false))
  })
}

export function main() {
  return Effect.gen(function* () {
    const failed = yield* Effect.catch(mixed(2), (error) => Effect.succeed(error.message))
    return [yield* pick("a"), yield* pick("b"), yield* mixed(1), failed, [yield* nested(1, 2), yield* nested(1, 3), yield* nested(2, 2)], yield* inBlock, yield* tail(1)]
  })
}
