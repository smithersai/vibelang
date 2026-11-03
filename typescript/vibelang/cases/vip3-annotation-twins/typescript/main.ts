import { Effect, Scope } from "effect"

export function full(text: string): Effect.Effect<number, TypeError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.void)
    const n = Number(text)
    if (Number.isNaN(n)) return yield* Effect.fail(new TypeError(text))
    return n
  })
}

export function wide(text: string): Effect.Effect<number | string, TypeError | RangeError, Scope.Scope> {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.void)
    if (text === "") return yield* Effect.fail(new TypeError(text))
    return text
  })
}

export function parse(text: string): Effect.Effect<number, TypeError> {
  return Effect.gen(function* () {
    const n = Number(text)
    if (Number.isNaN(n)) return yield* Effect.fail(new TypeError(text))
    return n
  })
}

export function total(): Effect.Effect<number> {
  return Effect.gen(function* () {
    return 1
  })
}

export function scoped(): Effect.Effect<number, never, Scope.Scope> {
  return Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.void)
    return 1
  })
}

export function literal(): Effect.Effect<"a" | "b"> {
  return Effect.gen(function* (): Effect.fn.Return<"a" | "b"> {
    return "a"
  })
}

export function tagged(): Effect.Effect<{ kind: "a" } | { kind: "b" }> {
  return Effect.gen(function* () {
    return { kind: "a" }
  })
}

export type Load = Effect.Effect<number, TypeError, Scope.Scope>
export function aliased(text: string): Load {
  return Effect.gen(function* () {
    return yield* full(text)
  })
}

export function longForm(text: string): Effect.Effect<number, TypeError> {
  return Effect.gen(function* () {
    return yield* parse(text)
  })
}

export function inferred(text: string) {
  return Effect.gen(function* () {
    const n = Number(text)
    if (Number.isNaN(n)) return yield* Effect.fail(new TypeError(text))
    return n
  })
}

export const arrow = (n: number): Effect.Effect<number, RangeError> =>
  Effect.gen(function* () {
    if (n < 0) return yield* Effect.fail(new RangeError("negative"))
    return n
  })
