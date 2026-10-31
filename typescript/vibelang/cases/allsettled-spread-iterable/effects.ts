import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

export const log: string[] = []

/** @throws {never} */
export function tag(e: Exit.Exit<unknown, unknown>): string {
  if (Exit.isSuccess(e)) return "Success:" + String(e.value)
  const reason = e.cause.reasons[0]
  return "Failure:" + String(reason._tag === "Fail" ? reason.error : reason._tag)
}

/** @throws {never} */
export function set(): Set<Effect.Effect<number, string>> {
  return new Set([Effect.succeed(1)])
}

/** @throws {never} */
export function custom(): Effect.Effect<string, string>[] {
  const xs = [Effect.succeed("indexed")]
  Object.defineProperty(xs, Symbol.iterator, {
    value: function* () {
      log.push("iterate")
      yield Effect.succeed("iterated")
    }
  })
  return xs
}

/** @throws {never} */
export function generated(): Iterable<Effect.Effect<number, string>> {
  return (function* () {
    yield Effect.succeed(2)
    yield Effect.fail("g")
  })()
}

export function first(): Effect.Effect<number, string> {
  return Effect.succeed(0)
}

export function last(): Effect.Effect<number, string> {
  return Effect.fail("e")
}
