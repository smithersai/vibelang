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
export function install(): Effect.Effect<string, string> {
  log.push("install")
  return Effect.succeed("i")
}

/** @throws {never} */
export function restore(): Effect.Effect<string, string> {
  log.push("restore")
  return Effect.fail("r")
}

/** @throws {never} */
export function counted(): Set<Effect.Effect<number, string>> {
  const s = new Set([Effect.succeed(1), Effect.succeed(2)])
  const iterate = s[Symbol.iterator].bind(s)
  Object.defineProperty(s, Symbol.iterator, { value: function* () { log.push("iterate"); yield* iterate() } })
  return s
}
